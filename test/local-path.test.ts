import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalizeLocalPath, isWithinLocalRoot, normalizeLocalAbsolutePath } from "../src/local-path.js";
import { WorkingDirectoryResolver } from "../src/working-directory.js";
import { openRecordedOutputDirectory } from "../src/output-directory.js";
import { ProjectRegistry } from "../src/project-registry.js";
import { normalizeWriteRoots } from "../src/write-claims.js";
import { validateWindowsCwd } from "../src/tools.js";

test("Windows compatibility and POSIX case-sensitive scopes stay separate", () => {
  assert.equal(canonicalizeLocalPath("C:/Project/中文/"), "c:\\project\\中文");
  assert.equal(canonicalizeLocalPath("/Users/Demo/中文 空格/"), "/Users/Demo/中文 空格");
  assert.equal(validateWindowsCwd("/Users/Demo/Projects"), "/Users/Demo/Projects");
  assert.ok(isWithinLocalRoot("C:\\", "c:\\Project"));
  assert.ok(isWithinLocalRoot("/", "/Users/Demo"));
  assert.ok(isWithinLocalRoot("/Users/Demo/Project", "/Users/Demo/Project/file.txt"));
  assert.equal(isWithinLocalRoot("/Users/Demo/Project", "/Users/Demo/project/file.txt"), false);
  assert.equal(isWithinLocalRoot("/Users/Demo/Project", "/Users/Demo/Project-other/file.txt"), false);
  assert.equal(isWithinLocalRoot("/Users/Demo/Project", "C:\\Project"), false);
  assert.deepEqual(normalizeWriteRoots(["/Users/Demo/Project/", "/Users/Demo/project"]), ["/Users/Demo/Project", "/Users/Demo/project"]);
  for (const value of ["relative", "~/Project", "\\\\server\\share", "//server/share", "/Users/Demo\nX", "/Users/Demo\0", "/Users/Demo\\file"]) {
    assert.throws(() => normalizeLocalAbsolutePath(value), Error, value);
  }
});

test("POSIX resolver checks realpath, scope, existence and foreign paths before execution", () => {
  const resolver = new WorkingDirectoryResolver({ platform: "darwin", stat: () => ({ isDirectory: () => true }), realpath: (p) => p.endsWith("/link") ? "/outside" : p });
  assert.equal(resolver.resolve('"/Users/Demo/中文 空格"').safe_process_cwd, "/Users/Demo/中文 空格");
  assert.equal(resolver.lastTrace()?.win32_current_directory, null);
  assert.throws(() => resolver.resolve("C:\\Project"), /本机绝对路径/);
  assert.throws(() => resolver.resolve("/approved/link", ["/approved"]), /允许的项目范围/);
  assert.throws(() => resolver.resolve("/approved-other", ["/approved"]), /允许的项目范围/);
});

test("host-native Unicode project is read-only and survives registry reopening", () => {
  const root = mkdtempSync(join(tmpdir(), "lcb-project-"));
  try {
    const project = join(root, "项目 空格"); mkdirSync(project);
    const file = join(root, "projects.json");
    writeFileSync(file, JSON.stringify({ schema_version: 1, projects: [{ project_id: "demo", project_name: "项目", root_path: project, allowed_capabilities: ["file_read"] }] }));
    const registry = new ProjectRegistry(file);
    assert.equal(registry.resolve("demo").cwd, project);
    assert.equal(new ProjectRegistry(file).get("demo").available, true);
    const resolver = new WorkingDirectoryResolver();
    assert.equal(resolver.resolve(project, [root]).safe_process_cwd, realpathSync.native(project));
    assert.throws(() => resolver.resolve(join(root, "missing")));
    assert.throws(() => resolver.resolve(file));
    if (process.platform !== "win32") {
      const outside = join(root, "outside"); mkdirSync(outside);
      symlinkSync(outside, join(project, "escape"));
      assert.throws(() => resolver.resolve(join(project, "escape"), [project]), /允许的项目范围/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Finder opener uses one recorded argv and rejects a Windows path on Mac", () => {
  const calls: unknown[] = [];
  const options = { platform: "darwin" as const, stat: () => ({ isDirectory: () => true }), spawn: (file: string, args: string[], opts: Record<string, unknown>) => { calls.push({ file, args, opts }); return { unref() {} } as never; } };
  assert.equal(openRecordedOutputDirectory("/Users/Demo/输出 目录", options), "/Users/Demo/输出 目录");
  assert.deepEqual(calls, [{ file: "/usr/bin/open", args: ["/Users/Demo/输出 目录"], opts: { detached: true, stdio: "ignore", windowsHide: true } }]);
  assert.throws(() => openRecordedOutputDirectory("C:\\Project", options), /different operating system/);
  assert.equal(calls.length, 1);
});
