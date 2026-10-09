import { createHash } from "node:crypto";

import { normalizeWriteRoots } from "./write-claims.js";
import { normalizeRequiredOutputPaths } from "./working-directory.js";

export type TaskSandbox = "read-only" | "workspace-write";

export interface TaskDefinition {
  name: string;
  title?: string;
  text: string;
  cwd: string;
  fingerprint: string;
  task_type?: string;
  task_complexity?: "normal" | "high";
  requested_model?: string;
  requested_effort?: string;
  approval_policy?: "untrusted" | "on-request" | "never";
  existing_thread_id?: string;
  sandbox: TaskSandbox;
  write_roots: string[];
  required_outputs?: string[];
  idempotency_key?: string;
}

export interface TaskDefinitionInput {
  name?: string;
  title?: string;
  task_title?: string;
  text: string;
  cwd: string;
  fingerprint?: string;
  idempotency_key?: string;
  task_type?: string;
  task_complexity?: "normal" | "high";
  model?: string;
  effort?: string;
  approval_policy?: "untrusted" | "on-request" | "never";
  existing_thread_id?: string;
  sandbox?: TaskSandbox;
  write_roots?: string[];
  required_outputs?: string[];
}

export function deriveTaskFingerprint(input: TaskDefinitionInput): string {
  const explicit = input.idempotency_key?.trim() || input.fingerprint?.trim();
  if (explicit) {
    if (explicit.length > 256) throw new Error("idempotency key must be at most 256 characters");
    return explicit;
  }
  // The prompt is hashed in memory only; the durable store keeps the digest,
  // never the original task text.
  const material = JSON.stringify({
    text: input.text,
    cwd: input.cwd,
    task_type: input.task_type ?? "general",
    task_complexity: input.task_complexity ?? "normal",
    model: input.model ?? null,
    effort: input.effort ?? null,
    approval_policy: input.approval_policy ?? null,
    sandbox: input.sandbox ?? "read-only",
    write_roots: normalizeWriteRoots(input.write_roots ?? []),
    required_outputs: normalizeRequiredOutputPaths(input.required_outputs ?? []),
  });
  return "sha256:" + createHash("sha256").update(material, "utf8").digest("hex");
}

export function normalizeTaskDefinition(input: TaskDefinitionInput): TaskDefinition {
  const text = input.text.trim();
  if (!text) {
    throw new Error("task text must not be empty");
  }
  const sandbox = input.sandbox ?? "read-only";
  const writeRoots = normalizeWriteRoots(input.write_roots ?? []);
  if (sandbox === "workspace-write" && writeRoots.length === 0) {
    throw new Error("workspace-write tasks require write_roots");
  }
  if (sandbox === "read-only" && writeRoots.length > 0) {
    throw new Error("read-only tasks cannot claim write_roots");
  }
  const title = resolveTaskTitle(input.title ?? input.task_title ?? input.name, text);
  const requiredOutputs = normalizeRequiredOutputPaths(input.required_outputs ?? []);
  return {
    name: title,
    title,
    text,
    cwd: input.cwd,
    fingerprint: deriveTaskFingerprint(input),
    ...(input.task_type?.trim() ? { task_type: input.task_type.trim() } : {}),
    ...(input.task_complexity ? { task_complexity: input.task_complexity } : {}),
    ...(input.model?.trim() ? { requested_model: input.model.trim() } : {}),
    ...(input.effort?.trim() ? { requested_effort: input.effort.trim() } : {}),
    ...(input.approval_policy ? { approval_policy: input.approval_policy } : {}),
    ...(input.existing_thread_id?.trim() ? { existing_thread_id: input.existing_thread_id.trim() } : {}),
    sandbox,
    write_roots: writeRoots,
    required_outputs: requiredOutputs,
    ...(input.idempotency_key?.trim()
      ? { idempotency_key: input.idempotency_key.trim() }
      : {}),
  };
}

export function resolveTaskTitle(explicit: string | undefined, inputText: string, fallback = "Codex 任务"): string {
  const provided = explicit?.trim();
  if (provided) return provided.slice(0, 120);
  const firstLine = inputText.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  const local = firstLine
    .replace(/^(请|请帮我|帮我|麻烦|任务[:：]|需求[:：])\s*/u, "")
    .replace(/[。！？.!?]+$/u, "")
    .trim();
  if (local && !/^codex\s+(任务|task)/iu.test(local)) return local.slice(0, 120);
  return fallback;
}
