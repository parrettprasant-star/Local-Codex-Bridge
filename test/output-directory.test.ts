import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeRecordedOutputDirectory,
  openRecordedOutputDirectory,
  OutputDirectoryError,
} from "../src/output-directory.js";

test("recorded output directories canonicalize Windows paths without prompt text", () => {
  assert.equal(
    canonicalizeRecordedOutputDirectory("c:/Users/测试用户/素材/"),
    "c:\\Users\\测试用户\\素材",
  );
  assert.throws(
    () => canonicalizeRecordedOutputDirectory("\\\\server\\share"),
    (error: unknown) => error instanceof OutputDirectoryError && error.code === "invalid",
  );
});

test("opening output directory uses only the recorded path and explorer argv", () => {
  const calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
  const opened = openRecordedOutputDirectory("C:\\Users\\测试用户\\输出 目录\\", {
    platform: "win32",
    stat: () => ({ isDirectory: () => true }),
    spawn: (file, args, options) => {
      calls.push({ file, args, options });
      return { unref() {} } as never;
    },
  });
  assert.equal(opened, "C:\\Users\\测试用户\\输出 目录");
  assert.deepEqual(calls, [{
    file: "explorer.exe",
    args: ["C:\\Users\\测试用户\\输出 目录"],
    options: { detached: true, stdio: "ignore", windowsHide: true },
  }]);
});
