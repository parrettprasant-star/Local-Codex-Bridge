import { statSync } from "node:fs";

import {
  canonicalizeWindowsPath,
} from "./write-claims.js";
import type { TaskRecord } from "./task-manager.js";
import type {
  ResultIntegrity,
  ResultIntegrityEntry,
  ResultVerification,
} from "./result-manifest.js";

export interface ResultIntegrityStats {
  isFile(): boolean;
  isDirectory(): boolean;
  size: number;
  mtime: Date;
}

export interface ResultIntegrityOptions {
  stat?: (path: string) => ResultIntegrityStats;
  now?: () => Date;
}

function isWithinScope(candidate: string, roots: readonly string[]): boolean {
  return roots.some((root) => candidate === root || candidate.startsWith(root + "\\"));
}

function canonicalRoots(task: TaskRecord): string[] {
  const roots = [task.cwd, ...task.write_claims];
  const normalized = new Set<string>();
  for (const root of roots) {
    if (!root) continue;
    try {
      normalized.add(canonicalizeWindowsPath(root));
    } catch {
      // Invalid task roots make output verification fail closed below.
    }
  }
  return [...normalized];
}

function entry(
  path: string,
  expectedType: "file" | "directory",
  values: Partial<ResultIntegrityEntry> = {},
): ResultIntegrityEntry {
  return {
    path,
    canonical_path: values.canonical_path ?? null,
    expected_type: expectedType,
    actual_type: values.actual_type ?? "unknown",
    verification: values.verification ?? "ERROR",
    exists: values.exists ?? false,
    size_bytes: values.size_bytes ?? null,
    modified_at: values.modified_at ?? null,
  };
}

function warningFor(path: string, verification: ResultVerification): string {
  switch (verification) {
    case "MISSING": return "Missing output: " + path;
    case "ZERO_BYTE": return "Zero-byte output: " + path;
    case "OUT_OF_SCOPE": return "Output outside allowed workspace scope: " + path;
    case "NOT_FILE": return "Declared file is not a regular file: " + path;
    case "NOT_DIRECTORY": return "Declared output directory is not a directory: " + path;
    case "ERROR": return "Unable to verify output: " + path;
    case "PASS": return "";
  }
}

export function verifyResultIntegrity(
  task: TaskRecord,
  options: ResultIntegrityOptions = {},
): ResultIntegrity {
  const now = options.now ?? (() => new Date());
  const stat = options.stat ?? ((path: string) => statSync(path));
  const roots = canonicalRoots(task);
  const entries: ResultIntegrityEntry[] = [];
  const warnings: string[] = [];
  let filesVerified = 0;
  let directoriesVerified = 0;
  let zeroByteFiles = 0;
  let missingPaths = 0;
  let outOfScopePaths = 0;
  let hasError = false;
  const declaredFiles = [...new Set([
    ...task.output_files,
    ...(task.result_manifest.required_outputs ?? []),
  ])];

  const check = (path: string, expectedType: "file" | "directory"): void => {
    let canonical: string;
    try {
      canonical = canonicalizeWindowsPath(path);
    } catch {
      outOfScopePaths += 1;
      const result = entry(path, expectedType, { verification: "OUT_OF_SCOPE" });
      entries.push(result);
      warnings.push(warningFor(path, result.verification));
      return;
    }
    if (!isWithinScope(canonical, roots)) {
      outOfScopePaths += 1;
      const result = entry(path, expectedType, {
        canonical_path: canonical,
        verification: "OUT_OF_SCOPE",
      });
      entries.push(result);
      warnings.push(warningFor(path, result.verification));
      return;
    }
    let info: ResultIntegrityStats;
    try {
      info = stat(canonical);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (code === "ENOENT" || code === "ENOTDIR") {
        missingPaths += 1;
        const result = entry(path, expectedType, {
          canonical_path: canonical,
          actual_type: "missing",
          verification: "MISSING",
        });
        entries.push(result);
        warnings.push(warningFor(path, result.verification));
      } else {
        hasError = true;
        const result = entry(path, expectedType, {
          canonical_path: canonical,
          verification: "ERROR",
        });
        entries.push(result);
        warnings.push(warningFor(path, result.verification));
      }
      return;
    }
    const actualType = info.isFile() ? "file" : info.isDirectory() ? "directory" : "other";
    const modifiedAt = info.mtime instanceof Date ? info.mtime.toISOString() : null;
    if (expectedType === "file" && actualType !== "file") {
      const result = entry(path, expectedType, {
        canonical_path: canonical,
        actual_type: actualType,
        verification: "NOT_FILE",
        exists: true,
        size_bytes: Number.isSafeInteger(info.size) ? info.size : null,
        modified_at: modifiedAt,
      });
      entries.push(result);
      warnings.push(warningFor(path, result.verification));
      return;
    }
    if (expectedType === "directory" && actualType !== "directory") {
      const result = entry(path, expectedType, {
        canonical_path: canonical,
        actual_type: actualType,
        verification: "NOT_DIRECTORY",
        exists: true,
        size_bytes: Number.isSafeInteger(info.size) ? info.size : null,
        modified_at: modifiedAt,
      });
      entries.push(result);
      warnings.push(warningFor(path, result.verification));
      return;
    }
    if (expectedType === "file") {
      filesVerified += 1;
      if (info.size === 0) {
        zeroByteFiles += 1;
        const result = entry(path, expectedType, {
          canonical_path: canonical,
          actual_type: actualType,
          verification: "ZERO_BYTE",
          exists: true,
          size_bytes: 0,
          modified_at: modifiedAt,
        });
        entries.push(result);
        warnings.push(warningFor(path, result.verification));
        return;
      }
    } else {
      directoriesVerified += 1;
    }
    entries.push(entry(path, expectedType, {
      canonical_path: canonical,
      actual_type: actualType,
      verification: "PASS",
      exists: true,
      size_bytes: expectedType === "file" && Number.isSafeInteger(info.size) ? info.size : null,
      modified_at: modifiedAt,
    }));
  };

  for (const path of declaredFiles) check(path, "file");
  for (const path of task.output_directories) check(path, "directory");

  const declaredOutputCount = task.result_manifest.integrity.declared_output_count;
  const recordedOutputCount = task.output_files.length + task.output_directories.length;
  if (declaredOutputCount !== null && declaredOutputCount !== recordedOutputCount) {
    warnings.push(
      `Declared output count ${declaredOutputCount} differs from recorded ${recordedOutputCount}`,
    );
  }
  const status: ResultIntegrity["status"] = hasError
    ? "ERROR"
    : outOfScopePaths > 0
      ? "UNVERIFIED"
      : warnings.length > 0
        ? "WARN"
        : "PASS";
  return {
    status,
    checked_at: now().toISOString(),
    files_declared: declaredFiles.length,
    files_verified: filesVerified,
    directories_declared: task.output_directories.length,
    directories_verified: directoriesVerified,
    recorded_output_count: recordedOutputCount,
    declared_output_count: declaredOutputCount,
    zero_byte_files: zeroByteFiles,
    missing_paths: missingPaths,
    out_of_scope_paths: outOfScopePaths,
    entries,
    warnings: warnings.slice(0, 50),
    error_summary: hasError ? "One or more outputs could not be verified" : null,
  };
}
