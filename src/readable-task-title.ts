import type { TaskRecord } from "./task-manager.js";

export const READABLE_TASK_TITLE_LIMIT = 56;

export type ReadableTaskTitleSource = "native" | "preview" | "task" | "fallback";

export interface ReadableTaskTitleResolution {
  title: string;
  source: ReadableTaskTitleSource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function textFromValue(value: unknown, depth = 0): string | null {
  if (depth > 3) return null;
  const direct = stringValue(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => textFromValue(item, depth + 1))
      .filter((item): item is string => item !== null);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  if (!isRecord(value)) return null;
  for (const key of ["text", "value", "message", "content", "input", "preview"]) {
    const candidate = textFromValue(value[key], depth + 1);
    if (candidate) return candidate;
  }
  return null;
}

function meaningful(value: string | null): value is string {
  if (!value) return false;
  const normalized = value.trim();
  if (!normalized) return false;
  return !/^(?:codex(?:\s+原生任务|\s+任务)?|暂无任务|未命名任务|背景|目标|要求|说明)[:：]?$/iu.test(normalized);
}

export function isGeneratedNativeTaskTitle(value: string | null | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return /^Codex\s+任务\s+[^/\s]+\/[^/\s]+$/iu.test(normalized) ||
    /^Codex\s+原生任务(?:\s*[·•:：]\s*[^\s]+)?$/u.test(normalized);
}

function truncate(value: string): string {
  const chars = Array.from(value.trim());
  if (chars.length <= READABLE_TASK_TITLE_LIMIT) return chars.join("");
  return chars.slice(0, READABLE_TASK_TITLE_LIMIT - 1).join("") + "…";
}

function cleanCandidate(value: string): string | null {
  let candidate = value
    .replace(/^\s*[#>*•\-]+\s*/u, "")
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/^['"“”「」『』]+|['"“”「」『』]+$/gu, "")
    .trim();

  const prefixes = [
    /^请在当前(?:仓库|项目|工作区)中\s*/u,
    /^在当前(?:仓库|项目|工作区)中\s*/u,
    /^请继续\s*/u,
    /^继续\s*/u,
    /^(?:执行|实施)一个受控的小版本修复\s*[:：]?\s*/u,
    /^(?:执行|实施)(?:一个)?小版本修复\s*[:：]?\s*/u,
    /^请(?:帮我|协助我)?\s*/u,
  ];
  let changed = true;
  while (changed && candidate.length > 0) {
    changed = false;
    for (const prefix of prefixes) {
      const next = candidate.replace(prefix, "").trim();
      if (next !== candidate) {
        candidate = next;
        changed = true;
        break;
      }
    }
  }

  candidate = candidate.replace(/^(?:背景|目标|要求|说明)\s*[:：]\s*/u, "").trim();
  const sentenceEnd = candidate.search(/[。！？!?]/u);
  if (sentenceEnd > 0) candidate = candidate.slice(0, sentenceEnd);
  candidate = candidate.replace(/[。！？!?；;，,]+$/u, "").trim();
  return meaningful(candidate) ? truncate(candidate) : null;
}

function firstReadableSentence(values: readonly unknown[]): string | null {
  for (const value of values) {
    const text = textFromValue(value);
    if (!text) continue;
    const lines = text.split(/\r?\n/u);
    for (const line of lines) {
      const candidate = cleanCandidate(line);
      if (candidate) return candidate;
    }
  }
  return null;
}

function nativeTitle(result: Record<string, unknown>): string | null {
  const thread = record(result.thread);
  for (const value of [thread.name, thread.title, result.name, result.title]) {
    const candidate = cleanCandidate(textFromValue(value) ?? "");
    if (candidate && !isGeneratedNativeTaskTitle(candidate)) return candidate;
  }
  return null;
}

function previewValues(result: Record<string, unknown>): unknown[] {
  const thread = record(result.thread);
  return [
    thread.preview,
    result.preview,
    thread.summary,
    result.summary,
  ];
}

function firstUserMessage(result: Record<string, unknown>): string | null {
  const root = record(result);
  const thread = record(root.thread);
  const collections: unknown[] = [thread.messages, root.messages, thread.turns, root.turns];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      const itemRecord = record(item);
      const role = String(itemRecord.role ?? itemRecord.author ?? itemRecord.type ?? "").toLowerCase();
      if (role.includes("user")) {
        const candidate = firstReadableSentence([itemRecord.text, itemRecord.content, itemRecord.message, itemRecord.input, item]);
        if (candidate) return candidate;
      }
      const items = itemRecord.items;
      if (!Array.isArray(items)) continue;
      for (const nested of items) {
        const nestedRecord = record(nested);
        const nestedRole = String(nestedRecord.role ?? nestedRecord.author ?? nestedRecord.type ?? "").toLowerCase();
        if (!nestedRole.includes("user")) continue;
        const candidate = firstReadableSentence([nestedRecord.text, nestedRecord.content, nestedRecord.message, nestedRecord.input, nested]);
        if (candidate) return candidate;
      }
    }
  }
  return null;
}

function taskTitle(task: TaskRecord): string | null {
  const manifestTitle = stringValue(task.result_manifest.task_title);
  if (meaningful(manifestTitle) && !isGeneratedNativeTaskTitle(manifestTitle)) return truncate(manifestTitle);
  if (meaningful(task.name) && !isGeneratedNativeTaskTitle(task.name)) return truncate(task.name);
  return null;
}

function fallbackTitle(task: TaskRecord): string {
  const shortThread = task.thread_id ? task.thread_id.slice(0, 8) : task.id.slice(0, 8);
  return "Codex 原生任务 · " + shortThread;
}

export function resolveReadableTaskTitle(
  task: TaskRecord,
  threadReadResult: unknown,
): ReadableTaskTitleResolution {
  const result = record(threadReadResult);
  const native = nativeTitle(result);
  if (native) return { title: native, source: "native" };

  const preview = firstReadableSentence(previewValues(result));
  if (preview) return { title: preview, source: "preview" };

  const userMessage = firstUserMessage(result);
  if (userMessage) return { title: userMessage, source: "preview" };

  const existing = taskTitle(task);
  if (existing) return { title: existing, source: "task" };

  return { title: fallbackTitle(task), source: "fallback" };
}
