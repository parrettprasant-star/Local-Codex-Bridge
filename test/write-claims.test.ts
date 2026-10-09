import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeWindowsPath,
  pathsOverlap,
  WriteClaimConflictError,
  WriteClaimRegistry,
} from "../src/write-claims.js";

test("Windows write claim canonicalization handles case, separators, and ancestry", () => {
  assert.equal(canonicalizeWindowsPath("C:\\A\\"), "c:\\a");
  assert.equal(canonicalizeWindowsPath("c:/a/b/"), "c:\\a\\b");
  assert.equal(pathsOverlap("C:\\A", "c:\\a\\b"), true);
  assert.equal(pathsOverlap("C:\\A", "C:\\B"), false);
  assert.equal(pathsOverlap("C:\\Users\\测试用户\\素材", "c:/users/测试用户/素材/子目录"), true);
});

test("read-only work does not claim and overlapping write roots are blocked", () => {
  const registry = new WriteClaimRegistry(() => new Date("2026-08-21T01:00:00.000Z"));
  const claim = registry.claim("task-1", ["C:\\A"]);
  assert.equal(claim.roots[0], "c:\\a");
  assert.equal(registry.hasConflict("task-read-only", []), null);
  assert.throws(
    () => registry.claim("task-2", ["c:/a/b"]),
    (error: unknown) => error instanceof WriteClaimConflictError && error.conflict.task_id === "task-1",
  );
  assert.doesNotThrow(() => registry.claim("task-3", ["C:\\B"]));
  assert.equal(registry.releaseForTask("task-1"), 1);
  assert.doesNotThrow(() => registry.claim("task-2", ["c:/a/b"]));
});
