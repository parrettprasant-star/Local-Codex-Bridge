import { spawn, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";

import { normalizeLocalAbsolutePath, isWithinLocalRoot } from "./local-path.js";

export class OutputDirectoryError extends Error {
  readonly code: "invalid" | "unavailable" | "unsupported";

  constructor(code: "invalid" | "unavailable" | "unsupported", message: string) {
    super(message);
    this.name = "OutputDirectoryError";
    this.code = code;
  }
}

/**
 * Normalize a directory recorded by the task store. This intentionally accepts
 * only absolute local paths; prompt text never reaches this function.
 */
export function canonicalizeRecordedOutputDirectory(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OutputDirectoryError("invalid", "recorded output directory must be a non-empty path");
  }
  if (value.includes("\0") || value.length > 1_000) {
    throw new OutputDirectoryError("invalid", "recorded output directory is invalid");
  }
  if (/^(?:\\\\|\/\/|\\\\[?.]\\|\\[?.]\\)/.test(value)) {
    throw new OutputDirectoryError("invalid", "UNC and device paths are not allowed");
  }
  try { return normalizeLocalAbsolutePath(value); }
  catch { throw new OutputDirectoryError("invalid", "recorded output directory must be an absolute local path"); }
}

export function isRecordedOutputDirectoryWithinRoots(
  directory: string,
  roots: readonly string[],
): boolean {
  let candidate: string;
  try {
      candidate = normalizeLocalAbsolutePath(directory);
  } catch {
    return false;
  }
  return roots.some((root) => {
    try {
      return isWithinLocalRoot(root, candidate);
    } catch {
      return false;
    }
  });
}

export interface OutputDirectoryOpener {
  stat?: (directory: string) => { isDirectory: () => boolean };
  spawn?: (file: string, args: string[], options: Record<string, unknown>) => ChildProcess;
  platform?: NodeJS.Platform;
}

/** Open only a canonical, existing directory recorded in Task Store. */
export function openRecordedOutputDirectory(
  value: unknown,
  options: OutputDirectoryOpener = {},
): string {
  const directory = canonicalizeRecordedOutputDirectory(value);
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" && platform !== "darwin") {
    throw new OutputDirectoryError("unsupported", "opening output directories is supported on Windows and macOS");
  }
  if ((platform === "darwin") !== directory.startsWith("/")) {
    throw new OutputDirectoryError("invalid", "recorded directory belongs to a different operating system");
  }
  const stat = options.stat ?? ((candidate: string) => statSync(candidate));
  let info: { isDirectory: () => boolean };
  try {
    info = stat(directory);
  } catch {
    throw new OutputDirectoryError("unavailable", "recorded output directory is not available");
  }
  if (!info.isDirectory()) {
    throw new OutputDirectoryError("unavailable", "recorded output path is not a directory");
  }
  const launch = options.spawn ?? ((file, args, spawnOptions) => spawn(file, args, spawnOptions));
  const child = launch(platform === "darwin" ? "/usr/bin/open" : "explorer.exe", [directory], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return directory;
}
