import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TaskManager } from "../src/task-manager.js";
import { canonicalizeWindowsPath } from "../src/write-claims.js";
import { verifyResultIntegrity, type ResultIntegrityStats } from "../src/result-integrity.js";

function temporaryManager(): { directory: string; manager: TaskManager } {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-integrity-"));
  return { directory, manager: new TaskManager(join(directory, "tasks.json")) };
}

function fakeStat(values: Record<string, ResultIntegrityStats>, calls: string[]) {
  return (path: string): ResultIntegrityStats => {
    calls.push(path);
    const value = values[path];
    if (!value) {
      const error = new Error("missing") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return value;
  };
}

const file = (size: number): ResultIntegrityStats => ({
  isFile: () => true,
  isDirectory: () => false,
  size,
  mtime: new Date("2026-08-24T00:00:00.000Z"),
});

const directory = (): ResultIntegrityStats => ({
  isFile: () => false,
  isDirectory: () => true,
  size: 0,
  mtime: new Date("2026-08-24T00:00:00.000Z"),
});

test("result integrity passes real files and directories with Chinese Windows paths", () => {
  const temporary = temporaryManager();
  try {
    const manager = temporary.manager;
    const task = manager.create({
      name: "结果验证",
      fingerprint: "integrity-pass",
      status: "COMPLETED",
      cwd: "C:\\Users\\测试用户\\工作区",
      output_files: ["C:\\Users\\测试用户\\工作区\\结果\\清单.txt"],
      output_directories: ["C:\\Users\\测试用户\\工作区\\结果"],
    });
    const calls: string[] = [];
    const values = {
      [canonicalizeWindowsPath("C:\\Users\\测试用户\\工作区\\结果\\清单.txt")]: file(42),
      [canonicalizeWindowsPath("C:\\Users\\测试用户\\工作区\\结果")]: directory(),
    };
    const result = verifyResultIntegrity(task, {
      stat: fakeStat(values, calls),
      now: () => new Date("2026-08-24T01:00:00.000Z"),
    });
    assert.equal(result.status, "PASS");
    assert.equal(result.files_verified, 1);
    assert.equal(result.directories_verified, 1);
    assert.equal(result.entries[0]?.size_bytes, 42);
    assert.equal(calls.length, 2);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("result integrity verifies actual temporary files without mutation", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-real-output-"));
  try {
    const outputFile = join(directory, "真实结果.txt");
    writeFileSync(outputFile, "V4.2_RESULT_INTEGRITY_OK", "utf8");
    const manager = new TaskManager(join(directory, "tasks.json"));
    const task = manager.create({
      name: "真实文件验证",
      fingerprint: "integrity-real-file",
      status: "COMPLETED",
      cwd: directory,
      output_files: [outputFile],
      output_directories: [directory],
    });
    const result = verifyResultIntegrity(task);
    assert.equal(result.status, "PASS");
    assert.equal(result.files_verified, 1);
    assert.equal(result.directories_verified, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("result integrity records missing and zero-byte outputs as warnings", () => {
  const temporary = temporaryManager();
  try {
    const task = temporary.manager.create({
      name: "结果警告",
      fingerprint: "integrity-warn",
      status: "COMPLETED",
      cwd: "C:\\Bridge",
      output_files: ["C:\\Bridge\\empty.txt", "C:\\Bridge\\missing.txt"],
    });
    const values = {
      [canonicalizeWindowsPath("C:\\Bridge\\empty.txt")]: file(0),
    };
    const result = verifyResultIntegrity(task, { stat: fakeStat(values, []) });
    assert.equal(result.status, "WARN");
    assert.equal(result.zero_byte_files, 1);
    assert.equal(result.missing_paths, 1);
    assert.equal(result.warnings.length, 2);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("result integrity never stats an out-of-scope path", () => {
  const temporary = temporaryManager();
  try {
    const task = temporary.manager.create({
      name: "越界结果",
      fingerprint: "integrity-scope",
      status: "COMPLETED",
      cwd: "C:\\Bridge\\workspace",
      output_files: ["C:\\Windows\\system32\\secret.txt"],
    });
    const calls: string[] = [];
    const result = verifyResultIntegrity(task, {
      stat: fakeStat({}, calls),
    });
    assert.equal(result.status, "UNVERIFIED");
    assert.equal(result.out_of_scope_paths, 1);
    assert.equal(calls.length, 0);
    assert.equal(result.entries[0]?.verification, "OUT_OF_SCOPE");
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("result integrity reports verifier errors without throwing", () => {
  const temporary = temporaryManager();
  try {
    const task = temporary.manager.create({
      name: "权限异常",
      fingerprint: "integrity-error",
      status: "COMPLETED",
      cwd: "C:\\Bridge",
      output_files: ["C:\\Bridge\\protected.txt"],
    });
    const result = verifyResultIntegrity(task, {
      stat: () => {
        const error = new Error("access denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      },
    });
    assert.equal(result.status, "ERROR");
    assert.match(result.error_summary ?? "", /could not be verified/);
    assert.match(result.warnings[0] ?? "", /Unable to verify output/);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
});
