import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  WorkingDirectoryError,
  WorkingDirectoryResolver,
} from "../src/working-directory.js";

function temporaryDirectory(): string {
  return mkdtempSync(join(process.cwd(), ".staging", "cwd-matrix-中文 空格-"));
}

test("WorkingDirectoryResolver accepts Unicode/spaces and returns an unquoted process cwd", () => {
  const directory = temporaryDirectory();
  try {
    const resolver = new WorkingDirectoryResolver({ platform: "win32" });
    const resolved = resolver.resolve(directory + "\\");
    assert.equal(resolved.safe_process_cwd.includes('"'), false);
    assert.equal(resolved.canonical_cwd, directory);
    assert.equal(resolved.physical_cwd.toLowerCase(), directory.toLowerCase());
    assert.equal(resolved.safe_process_cwd, resolved.trace.win32_current_directory);
    assert.equal(resolved.trace.executor_cwd, resolved.trace.validated_cwd);
    assert.equal(resolved.trace.reason, null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("quoted cwd is unwrapped once and never becomes a short-path fallback", () => {
  const directory = temporaryDirectory();
  try {
    const resolver = new WorkingDirectoryResolver({ platform: "win32" });
    const requested = `"${directory}"`;
    const resolved = resolver.resolve(requested);
    assert.equal(resolved.canonical_cwd, directory);
    assert.equal(resolved.safe_process_cwd, directory);
    assert.equal(resolved.safe_process_cwd.includes("~"), false);
    assert.equal(resolved.trace.requested_cwd, requested);
    assert.equal(resolved.trace.normalized_cwd, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows child-process matrix works with the same canonical cwd", () => {
  const directory = temporaryDirectory();
  try {
    const resolver = new WorkingDirectoryResolver({ platform: "win32" });
    const cwd = resolver.resolve(directory).safe_process_cwd;
    const node = spawnSync(process.execPath, ["-e", "process.stdout.write(process.cwd())"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      shell: false,
    });
    assert.equal(node.status, 0);
    assert.equal(node.stdout, directory);
    if (process.platform === "win32") {
      const powershell = spawnSync(
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "(Get-Location).Path"],
        { cwd, encoding: "utf8", windowsHide: true, shell: false },
      );
      assert.equal(powershell.status, 0);
      const command = spawnSync("C:\\Windows\\System32\\cmd.exe", ["/d", "/c", "cd"], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        shell: false,
      });
      assert.equal(command.status, 0);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cwd launch probe covers ASCII, spaces, Unicode, and Unicode plus spaces", () => {
  const root = temporaryDirectory();
  const cases = [
    "Ascii",
    "Bridge Agent Test",
    "网络测试",
    "Bridge Agent 网络测试",
  ];
  try {
    const resolver = new WorkingDirectoryResolver({ platform: "win32" });
    for (const name of cases) {
      const directory = join(root, name);
      mkdirSync(directory, { recursive: true });
      const cwd = resolver.resolve(directory).safe_process_cwd;
      const child = spawnSync(process.execPath, ["-e", "process.stdout.write(process.cwd())"], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        shell: false,
      });
      assert.equal(child.status, 0, `${name}: ${child.stderr}`);
      assert.equal(child.stdout, directory, name);
      assert.equal(cwd.includes("~"), false, name);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("WorkingDirectoryResolver rejects quoted, missing, file, and reparse-escaped cwd values", () => {
  const directory = temporaryDirectory();
  const file = join(directory, "not-a-directory.txt");
  writeFileSync(file, "test", "utf8");
  try {
    const resolver = new WorkingDirectoryResolver({ platform: "win32" });
    assert.throws(() => resolver.resolve(`"${directory}`), (error: unknown) => {
      return error instanceof WorkingDirectoryError && error.code === "invalid_working_directory";
    });
    assert.throws(() => resolver.resolve(join(directory, "missing")), (error: unknown) => {
      return error instanceof WorkingDirectoryError && error.code === "working_directory_not_found";
    });
    assert.throws(() => resolver.resolve(file), (error: unknown) => {
      return error instanceof WorkingDirectoryError && error.code === "working_directory_not_directory";
    });
    assert.throws(() => resolver.resolve("C:\\Users\\测试用户\\Desktop\\BRIDGE~1"), (error: unknown) => {
      return error instanceof WorkingDirectoryError && error.code === "working_directory_short_path";
    });

    const escaped = new WorkingDirectoryResolver({
      platform: "win32",
      stat: () => ({ isDirectory: () => true }),
      realpath: (value) => value.endsWith("\\link") ? "C:\\outside" : value,
    });
    assert.throws(() => escaped.resolve("C:\\approved\\link", ["C:\\approved"]), (error: unknown) => {
      return error instanceof WorkingDirectoryError && error.code === "working_directory_outside_scope";
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
