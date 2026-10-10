import {
  realpathSync,
  statSync,
  type Stats,
} from "node:fs";
import path from "node:path";
import { normalizeLocalAbsolutePath, isWithinLocalRoot } from "./local-path.js";

const MAX_WORKING_DIRECTORY_CHARS = 1_000;
const MAX_REQUIRED_OUTPUTS = 50;
const MAX_REQUIRED_OUTPUT_CHARS = 1_000;

export type WorkingDirectoryErrorCode =
  | "invalid_working_directory"
  | "working_directory_not_found"
  | "working_directory_not_directory"
  | "working_directory_unavailable"
  | "working_directory_outside_scope"
  | "working_directory_short_path"
  | "working_directory_unsupported";

export class WorkingDirectoryError extends Error {
  readonly code: WorkingDirectoryErrorCode;
  readonly requested: string;

  constructor(code: WorkingDirectoryErrorCode, requested: string, message: string) {
    super(message);
    this.name = "WorkingDirectoryError";
    this.code = code;
    this.requested = requested;
  }
}

export interface WorkingDirectoryResolution {
  requested: string;
  canonical_cwd: string;
  safe_process_cwd: string;
  physical_cwd: string;
  trace: WorkingDirectoryTrace;
}

export interface WorkingDirectoryTrace {
  requested_cwd: string;
  normalized_cwd: string | null;
  validated_cwd: string | null;
  executor_cwd: string | null;
  win32_current_directory: string | null;
  reason: string | null;
}

export interface WorkingDirectoryResolverOptions {
  platform?: NodeJS.Platform;
  stat?: (value: string) => Pick<Stats, "isDirectory">;
  realpath?: (value: string) => string;
}

function isWindowsDrivePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) && path.win32.isAbsolute(value);
}

function isWithin(candidate: string, root: string): boolean {
  const left = candidate.toLowerCase();
  const right = root.toLowerCase();
  return left === right || left.startsWith(right.endsWith("\\") ? right : right + "\\");
}

function hasEightDotThreeSegment(value: string): boolean {
  return value
    .replace(/^[A-Za-z]:[\\/]?/, "")
    .split(/[\\/]+/)
    .some((segment) => /^[^\\/]{1,8}~[0-9]+$/.test(segment));
}

function withoutOuterDoubleQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    const inner = value.slice(1, -1);
    if (!inner.includes('"')) return inner;
  }
  return value;
}

export function stripOuterWindowsPathQuotes(value: string): string {
  return withoutOuterDoubleQuotes(value);
}

function lexicalWindowsPath(value: string, label: string, allowOuterQuotes = false): string {
  const candidate = allowOuterQuotes ? withoutOuterDoubleQuotes(value) : value;
  if (
    candidate.length === 0 ||
    candidate.length > MAX_WORKING_DIRECTORY_CHARS ||
    candidate !== candidate.trim() ||
    candidate.includes("\0") ||
    /[\r\n]/.test(candidate)
  ) {
    throw new WorkingDirectoryError(
      "invalid_working_directory",
      value,
      `${label}无效，请使用不带引号的绝对 Windows 文件夹路径。`,
    );
  }
  if (candidate.startsWith('"') || candidate.endsWith('"') || candidate.startsWith("'") || candidate.endsWith("'")) {
    throw new WorkingDirectoryError(
      "invalid_working_directory",
      value,
      `${label}不能包含命令行引号。`,
    );
  }
  if (/^(?:\\\\|\/\/|\\\\[?.]\\|\\[?.]\\)/.test(candidate) || !isWindowsDrivePath(candidate)) {
    throw new WorkingDirectoryError(
      "invalid_working_directory",
      value,
      `${label}必须是绝对 Windows 盘符路径，不能使用 UNC 或设备路径。`,
    );
  }
  const normalized = path.win32.normalize(candidate.replaceAll("/", "\\"));
  return normalized.length > 3 ? normalized.replace(/[\\]+$/, "") : normalized;
}

/**
 * Normalize a list of expected output files without touching the filesystem.
 * Existence is checked only when the execution result is finalized.
 */
export function normalizeRequiredOutputPaths(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_REQUIRED_OUTPUTS) {
    throw new WorkingDirectoryError(
      "invalid_working_directory",
      "",
      `required_outputs必须是最多 ${MAX_REQUIRED_OUTPUTS} 项的数组。`,
    );
  }
  const unique = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.length === 0 || item.length > MAX_REQUIRED_OUTPUT_CHARS) {
      throw new WorkingDirectoryError(
        "invalid_working_directory",
        typeof item === "string" ? item : "",
        `required_outputs[${index}]必须是有效的本机绝对文件路径。`,
      );
    }
    const normalized = normalizeLocalAbsolutePath(item);
    unique.add(normalized);
  }
  return [...unique];
}

export class WorkingDirectoryResolver {
  readonly #platform: NodeJS.Platform;
  readonly #stat: (value: string) => Pick<Stats, "isDirectory">;
  readonly #realpath: (value: string) => string;
  #lastTrace: WorkingDirectoryTrace | null = null;

  constructor(options: WorkingDirectoryResolverOptions = {}) {
    this.#platform = options.platform ?? process.platform;
    this.#stat = options.stat ?? ((value) => statSync(value));
    this.#realpath = options.realpath ?? ((value) => realpathSync.native(value));
  }

  lastTrace(): WorkingDirectoryTrace | null {
    return this.#lastTrace === null ? null : { ...this.#lastTrace };
  }

  #recordFailure(requested: string, normalized: string | null, reason: string): void {
    this.#lastTrace = {
      requested_cwd: requested,
      normalized_cwd: normalized,
      validated_cwd: null,
      executor_cwd: null,
      win32_current_directory: null,
      reason,
    };
  }

  resolve(requested: string, approvedRoots: readonly string[] = []): WorkingDirectoryResolution {
    if (this.#platform !== "win32") {
      return this.#resolvePosix(requested, approvedRoots);
    }
    let canonical: string;
    try {
      canonical = lexicalWindowsPath(requested, "工作目录", true);
    } catch (error) {
      this.#recordFailure(requested, null, error instanceof WorkingDirectoryError ? error.code : "invalid_working_directory");
      throw error;
    }
    if (hasEightDotThreeSegment(canonical)) {
      const failure = new WorkingDirectoryError(
        "working_directory_short_path",
        requested,
        "不接受 8.3 短路径，请使用实际的 Windows 文件夹路径。",
      );
      this.#recordFailure(requested, canonical, failure.code);
      throw failure;
    }
    let stats: Pick<Stats, "isDirectory">;
    try {
      stats = this.#stat(canonical);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      const failure = new WorkingDirectoryError(
        code === "ENOENT" || code === "ENOTDIR"
          ? "working_directory_not_found"
          : "working_directory_unavailable",
        requested,
        code === "ENOENT" || code === "ENOTDIR"
          ? "工作目录不存在，请重新选择。"
          : "无法读取指定工作目录，请检查权限。",
      );
      this.#recordFailure(requested, canonical, failure.code);
      throw failure;
    }
    if (!stats.isDirectory()) {
      const failure = new WorkingDirectoryError(
        "working_directory_not_directory",
        requested,
        "指定路径不是文件夹，请重新选择工作目录。",
      );
      this.#recordFailure(requested, canonical, failure.code);
      throw failure;
    }

    let physical: string;
    try {
      physical = lexicalWindowsPath(this.#realpath(canonical), "工作目录");
    } catch {
      const failure = new WorkingDirectoryError(
        "working_directory_unavailable",
        requested,
        "无法解析工作目录，请检查权限或重新选择。",
      );
      this.#recordFailure(requested, canonical, failure.code);
      throw failure;
    }
    if (hasEightDotThreeSegment(physical)) {
      const failure = new WorkingDirectoryError(
        "working_directory_short_path",
        requested,
        "工作目录解析成了 8.3 短路径，已拒绝继续启动。",
      );
      this.#recordFailure(requested, canonical, failure.code);
      throw failure;
    }
    const roots = approvedRoots.map((root) => {
      const lexical = lexicalWindowsPath(root, "批准的工作目录");
      try {
        return lexicalWindowsPath(this.#realpath(lexical), "批准的工作目录");
      } catch {
        throw new WorkingDirectoryError(
          "working_directory_unavailable",
          root,
          "无法解析批准的工作目录。",
        );
      }
    });
    if (roots.length > 0 && !roots.some((root) => isWithin(physical, root))) {
      const failure = new WorkingDirectoryError(
        "working_directory_outside_scope",
        requested,
        "工作目录不在当前任务允许的项目范围内。",
      );
      this.#recordFailure(requested, canonical, failure.code);
      throw failure;
    }
    const trace: WorkingDirectoryTrace = {
      requested_cwd: requested,
      normalized_cwd: canonical,
      validated_cwd: physical,
      executor_cwd: physical,
      win32_current_directory: physical,
      reason: null,
    };
    this.#lastTrace = trace;
    return {
      requested,
      canonical_cwd: canonical,
      // This value is deliberately never command-line quoted. Quoting is
      // applied only to argv values by the child-process layer. Use the
      // validated physical path so the process and scope checks share one
      // authoritative directory identity.
      safe_process_cwd: physical,
      physical_cwd: physical,
      trace,
    };
  }

  #resolvePosix(requested: string, approvedRoots: readonly string[]): WorkingDirectoryResolution {
    let canonical: string | null = null;
    try {
      canonical = normalizeLocalAbsolutePath(requested, true);
      if (!canonical.startsWith("/")) throw new WorkingDirectoryError("invalid_working_directory", requested, "请使用本机绝对路径，例如 /Users/你的用户名/Projects。");
      if (!this.#stat(canonical).isDirectory()) throw new WorkingDirectoryError("working_directory_not_directory", requested, "指定路径不是文件夹，请重新选择工作目录。");
      const physical = normalizeLocalAbsolutePath(this.#realpath(canonical));
      if (!physical.startsWith("/")) throw new Error("invalid physical directory");
      const roots = approvedRoots.map((root) => normalizeLocalAbsolutePath(this.#realpath(normalizeLocalAbsolutePath(root))));
      if (roots.length > 0 && !roots.some((root) => isWithinLocalRoot(root, physical))) {
        throw new WorkingDirectoryError("working_directory_outside_scope", requested, "工作目录不在当前任务允许的项目范围内。");
      }
      const trace: WorkingDirectoryTrace = {
        requested_cwd: requested, normalized_cwd: canonical, validated_cwd: physical,
        executor_cwd: physical, win32_current_directory: null, reason: null,
      };
      this.#lastTrace = trace;
      return { requested, canonical_cwd: canonical, safe_process_cwd: physical, physical_cwd: physical, trace };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const failure = error instanceof WorkingDirectoryError ? error : new WorkingDirectoryError(
        canonical === null ? "invalid_working_directory" : code === "ENOENT" || code === "ENOTDIR" ? "working_directory_not_found" : "working_directory_unavailable",
        requested, canonical === null ? "请使用不带引号的本机绝对项目路径。" : code === "ENOENT" || code === "ENOTDIR" ? "工作目录不存在，请重新选择。" : "无法读取指定工作目录，请检查权限。",
      );
      this.#recordFailure(requested, canonical, failure.code);
      throw failure;
    }
  }
}
