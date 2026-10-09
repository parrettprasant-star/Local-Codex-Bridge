import { spawn, type ChildProcess } from "node:child_process";

import { resolveCodexExecutable } from "./app-server.js";
import { redactText, sanitizeForTransport } from "./runtime.js";

const MAX_JSONL_BYTES = 10 * 1024 * 1024;
const MAX_STDERR_CHARS = 4_000;
const CAPABILITY_TIMEOUT_MS = 10_000;
const DEFAULT_SUBAGENT_LIMIT = 5;
const DEFAULT_SUBAGENT_DEPTH = 1;

export type EphemeralSandbox = "read-only" | "workspace-write";
export type EphemeralApprovalPolicy = "untrusted" | "on-request" | "never";

export interface EphemeralRunnerEvent {
  at: string;
  type: string;
  raw: Record<string, unknown>;
  text: string | null;
  subagent: {
    kind: "started" | "stopped";
    id: string | null;
  } | null;
}

export interface EphemeralRunTimings {
  started_at: string;
  first_event_at: string | null;
  first_answer_at: string | null;
  completed_at: string;
  startup_ms: number | null;
  time_to_first_event_ms: number | null;
  time_to_first_answer_ms: number | null;
  total_ms: number;
  phase_timings?: EphemeralPhaseTimings;
}

export interface EphemeralTimingContext {
  submitted_at?: string;
  task_created_at?: string;
  queue_entered_at?: string;
  worker_acquired_at?: string;
  dispatch_at?: string;
}

export interface EphemeralPhaseTimings {
  submitted_at: string | null;
  task_created_at: string | null;
  queue_entered_at: string | null;
  worker_acquired_at: string | null;
  dispatch_at: string | null;
  prepare_spawn_at: string;
  process_spawn_called_at: string;
  process_created_at: string | null;
  streams_ready_at: string | null;
  first_json_at: string | null;
  first_session_at: string | null;
  first_content_at: string | null;
  final_response_at: string;
  queue_wait_ms: number | null;
  worker_dispatch_ms: number | null;
  process_spawn_ms: number | null;
  codex_bootstrap_ms: number | null;
  first_json_ms: number | null;
  first_content_ms: number | null;
  total_ms: number;
}

export interface EphemeralSubagentReport {
  support: "native" | "degraded" | "not_available";
  reported: boolean;
  active: number;
  max_concurrent: number;
  started: number;
  stopped: number;
}

export interface EphemeralCodexResult {
  status: "completed" | "failed" | "interrupted";
  final_answer: string;
  exit_code: number | null;
  signal: string | null;
  stderr: string;
  events: EphemeralRunnerEvent[];
  timings: EphemeralRunTimings;
  subagents: EphemeralSubagentReport;
}

export interface EphemeralCodexRunRequest {
  cwd: string;
  prompt: string;
  model: string;
  effort: string;
  sandbox: EphemeralSandbox;
  approval_policy: EphemeralApprovalPolicy;
  max_subagents?: number;
  max_subagent_depth?: number;
  job_max_runtime_seconds?: number;
  timing_context?: EphemeralTimingContext;
  signal?: AbortSignal;
  onEvent?: (event: EphemeralRunnerEvent) => void;
}

export interface SubagentConfigCapabilities {
  max_concurrent_threads_per_session: boolean;
  max_depth: boolean;
  default_subagent_model: boolean;
  default_subagent_reasoning_effort: boolean;
  job_max_runtime_seconds: boolean;
}

export interface CodexCapabilitySnapshot {
  executable: string;
  version: string | null;
  detected_at: string;
  supports_ephemeral_exec: boolean;
  supports_json_events: boolean;
  supports_exec_sandbox: boolean;
  supports_exec_approval_policy: boolean;
  supports_exec_cwd: boolean;
  supports_multi_agent_feature: boolean;
  multi_agent_feature_state: "enabled" | "disabled" | "unavailable";
  multi_agent_v2_state: "enabled" | "disabled" | "unavailable";
  subagent_config: SubagentConfigCapabilities;
  native_subagents: "available" | "degraded" | "not_available";
  warnings: string[];
}

export interface EphemeralCodexRunnerOptions {
  executable?: string;
  clock?: () => Date;
  spawnProcess?: typeof spawn;
  capabilityProbe?: (args: readonly string[]) => Promise<CapabilityCommandResult>;
}

export interface CapabilityCommandResult {
  exit_code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

interface ParsedCapabilityLine {
  name: string;
  stage: string;
  enabled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function eventType(value: Record<string, unknown>): string {
  return stringValue(value.type) ?? stringValue(value.event) ?? stringValue(value.name) ?? "unknown";
}

function itemOf(value: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(value.item) ? value.item : null;
}

function textFromRecord(value: Record<string, unknown>): string | null {
  const item = itemOf(value);
  const itemType = stringValue(item?.type)?.toLowerCase() ?? "";
  if (item && ["agent_message", "agentmessage", "message", "output_text"].includes(itemType)) {
    const text = stringValue(item.text) ?? stringValue(item.content) ?? stringValue(item.delta);
    if (text) return text;
  }
  const turn = isRecord(value.turn) ? value.turn : null;
  if (turn) {
    const turnText = stringValue(turn.final_answer) ?? stringValue(turn.finalAnswer) ?? stringValue(turn.text);
    if (turnText) return turnText;
    if (Array.isArray(turn.items)) {
      for (let index = turn.items.length - 1; index >= 0; index -= 1) {
        const candidate = turn.items[index];
        if (isRecord(candidate)) {
          const nested = textFromRecord({ item: candidate });
          if (nested) return nested;
        }
      }
    }
  }
  const response = isRecord(value.response) ? value.response : null;
  if (response) {
    const responseText = stringValue(response.output_text) ?? stringValue(response.text);
    if (responseText) return responseText;
  }
  return stringValue(value.final_answer) ?? stringValue(value.finalAnswer) ?? stringValue(value.text) ?? stringValue(value.delta);
}

function hasSessionIdentity(value: Record<string, unknown>): boolean {
  for (const key of ["thread_id", "threadId", "session_id", "sessionId"]) {
    if (typeof value[key] === "string" && value[key].length > 0) return true;
  }
  for (const key of ["thread", "session", "turn", "item", "data", "result"]) {
    const nested = value[key];
    if (isRecord(nested) && hasSessionIdentity(nested)) return true;
  }
  return false;
}

function subagentFromRecord(value: Record<string, unknown>, type: string): EphemeralRunnerEvent["subagent"] {
  const item = itemOf(value);
  const itemType = stringValue(item?.type)?.toLowerCase() ?? "";
  const activity = stringValue(value.status) ?? stringValue(value.kind) ?? stringValue(value.activity) ?? "";
  const lower = `${type} ${itemType} ${activity}`.toLowerCase();
  const looksLikeSubagent =
    lower.includes("subagent") ||
    lower.includes("sub-agent") ||
    lower.includes("collab_agent") ||
    lower.includes("sub_agent") ||
    value.subagent !== undefined ||
    value.agent_thread_id !== undefined ||
    value.receiver_thread_id !== undefined;
  if (!looksLikeSubagent) return null;
  const id = stringValue(value.agent_thread_id) ??
    stringValue(value.agentThreadId) ??
    stringValue(value.subagent_thread_id) ??
    stringValue(value.subagentThreadId) ??
    stringValue(value.new_thread_id) ??
    stringValue(value.newThreadId) ??
    stringValue(value.thread_id) ??
    stringValue(item?.agent_thread_id) ??
    null;
  if (/(stop|stopped|complete|completed|end|ended|exit|exited|failed|cancel)/i.test(lower)) {
    return { kind: "stopped", id };
  }
  if (/(start|started|spawn|spawned|begin|began|running)/i.test(lower)) {
    return { kind: "started", id };
  }
  return null;
}

function appendText(previous: string, next: string): string {
  if (!next) return previous;
  if (!previous) return next;
  if (previous.endsWith(next)) return previous;
  if (next.startsWith(previous)) return next;
  return previous + next;
}

export function extractFinalAnswer(events: readonly EphemeralRunnerEvent[]): string {
  const fullMessages: string[] = [];
  let deltas = "";
  for (const event of events) {
    const item = itemOf(event.raw);
    const itemType = stringValue(item?.type)?.toLowerCase() ?? "";
    const type = event.type.toLowerCase();
    const text = event.text ?? "";
    if (!text) continue;
    const isDelta = type.includes("delta") || type.includes("stream") || itemType.includes("delta");
    const isAgentMessage =
      itemType === "agent_message" ||
      itemType === "agentmessage" ||
      type.includes("agent_message") ||
      type.includes("agentmessage") ||
      type.includes("final") ||
      type === "message";
    if (isDelta) {
      deltas = appendText(deltas, text);
    } else if (isAgentMessage || type.includes("completed")) {
      fullMessages.push(text);
    }
  }
  if (fullMessages.length > 0) return fullMessages.at(-1) ?? "";
  return deltas;
}

export class JsonlEventParser {
  readonly errors: string[] = [];
  #buffer = "";
  #bytes = 0;

  push(chunk: Buffer | string): Record<string, unknown>[] {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.#bytes += Buffer.byteLength(text, "utf8");
    if (this.#bytes > MAX_JSONL_BYTES) {
      throw new Error("Codex exec JSONL output exceeded 10 MiB");
    }
    this.#buffer += text;
    const records: Record<string, unknown>[] = [];
    while (true) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.#buffer.slice(0, newline).replace(/\r$/, "");
      this.#buffer = this.#buffer.slice(newline + 1);
      const parsed = this.#parse(line);
      if (parsed) records.push(parsed);
    }
    return records;
  }

  finish(): Record<string, unknown>[] {
    const line = this.#buffer.trim();
    this.#buffer = "";
    const parsed = this.#parse(line);
    return parsed ? [parsed] : [];
  }

  #parse(line: string): Record<string, unknown> | null {
    if (!line) return null;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) {
        this.errors.push("Codex exec JSONL event was not an object");
        return null;
      }
      return parsed;
    } catch {
      this.errors.push("Codex exec emitted a malformed JSONL event");
      return null;
    }
  }
}

export function normalizeEphemeralEvent(
  raw: Record<string, unknown>,
  clock: () => Date = () => new Date(),
): EphemeralRunnerEvent {
  const type = eventType(raw);
  const text = textFromRecord(raw);
  return {
    at: clock().toISOString(),
    type,
    raw: sanitizeForTransport(raw, {
      maxStringChars: 8_000,
      maxDepth: 7,
      maxArrayItems: 40,
      maxObjectKeys: 60,
      totalCharBudget: 32_000,
    }) as Record<string, unknown>,
    text,
    subagent: subagentFromRecord(raw, type),
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function configArgs(
  request: EphemeralCodexRunRequest,
  capabilities: CodexCapabilitySnapshot | null,
): string[] {
  const config = capabilities?.subagent_config;
  const allowed = (key: keyof SubagentConfigCapabilities): boolean => config?.[key] !== false;
  const args: string[] = [];
  const maxSubagents = Math.max(1, Math.min(DEFAULT_SUBAGENT_LIMIT, request.max_subagents ?? DEFAULT_SUBAGENT_LIMIT));
  const maxDepth = Math.max(1, Math.min(5, request.max_subagent_depth ?? DEFAULT_SUBAGENT_DEPTH));
  if (allowed("max_concurrent_threads_per_session")) args.push("-c", `agents.max_concurrent_threads_per_session=${maxSubagents}`);
  if (allowed("max_depth")) args.push("-c", `agents.max_depth=${maxDepth}`);
  if (allowed("default_subagent_model")) args.push("-c", `agents.default_subagent_model=${tomlString(request.model)}`);
  if (allowed("default_subagent_reasoning_effort")) args.push("-c", `agents.default_subagent_reasoning_effort=${tomlString(request.effort)}`);
  if (allowed("job_max_runtime_seconds") && request.job_max_runtime_seconds !== undefined) {
    const seconds = Math.max(1, Math.min(86_400, Math.trunc(request.job_max_runtime_seconds)));
    args.push("-c", `agents.job_max_runtime_seconds=${seconds}`);
  }
  return args;
}

export function buildEphemeralExecArgs(
  request: EphemeralCodexRunRequest,
  capabilities: CodexCapabilitySnapshot | null = null,
  includeSubagentConfig = true,
): string[] {
  const args = [
    "exec",
    "--ephemeral",
    "--json",
    "--model",
    request.model,
    "--sandbox",
    request.sandbox,
    "--cd",
    request.cwd,
    "--skip-git-repo-check",
    "-c",
    `approval_policy=${tomlString(request.approval_policy)}`,
  ];
  if (capabilities?.supports_multi_agent_feature !== false) args.push("--enable", "multi_agent");
  if (includeSubagentConfig && capabilities?.native_subagents !== "not_available") {
    args.push(...configArgs(request, capabilities));
  }
  args.push(request.prompt);
  return args;
}

async function waitForChild(
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ code: number | null; signal: string | null }> {
  if (child.exitCode !== null || child.signalCode !== null) return { code: child.exitCode, signal: child.signalCode };
  return await new Promise((resolve) => {
    let settled = false;
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.off("close", onClose);
      child.kill();
      resolve({ code: null, signal: "SIGKILL" });
    }, timeoutMs);
    child.once("close", onClose);
  });
}

async function runCapabilityCommand(
  executable: string,
  args: readonly string[],
  spawnProcess: typeof spawn,
): Promise<CapabilityCommandResult> {
  return await new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnProcess(executable, [...args], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let stdout = "";
    let stderr = "";
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString("utf8");
      return next.length > 20_000 ? next.slice(-20_000) : next;
    };
    child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once("error", (error) => reject(error));
    child.once("close", (code, signal) => resolve({ exit_code: code, signal, stdout, stderr }));
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }, CAPABILITY_TIMEOUT_MS).unref();
  });
}

function parseFeatureLines(output: string): ParsedCapabilityLine[] {
  const lines: ParsedCapabilityLine[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z0-9_]+)\s+(stable|experimental|under development|removed|deprecated)\s+(true|false)\s*$/i);
    if (!match) continue;
    lines.push({ name: match[1]!, stage: match[2]!.toLowerCase(), enabled: match[3]!.toLowerCase() === "true" });
  }
  return lines;
}

function parseVersion(output: string): string | null {
  return output.match(/codex-cli\s+([0-9]+(?:\.[0-9]+){1,3})/i)?.[1] ?? null;
}

const SUBAGENT_CONFIG_KEYS: (keyof SubagentConfigCapabilities)[] = [
  "max_concurrent_threads_per_session",
  "max_depth",
  "default_subagent_model",
  "default_subagent_reasoning_effort",
  "job_max_runtime_seconds",
];

export async function detectCodexCapabilities(
  options: EphemeralCodexRunnerOptions = {},
): Promise<CodexCapabilitySnapshot> {
  const executable = options.executable ?? resolveCodexExecutable();
  const spawnProcess = options.spawnProcess ?? spawn;
  const probe = options.capabilityProbe ?? ((args: readonly string[]) => runCapabilityCommand(executable, args, spawnProcess));
  const warnings: string[] = [];
  const [version, help, features, config] = await Promise.all([
    probe(["--version"]),
    probe(["exec", "--help"]),
    probe(["features", "list"]),
    probe([
      "app-server",
      "--strict-config",
      "-c",
      'approval_policy="on-request"',
      "-c",
      "features.multi_agent=true",
      "-c",
      "agents.max_concurrent_threads_per_session=5",
      "-c",
      "agents.max_depth=1",
      "-c",
      'agents.default_subagent_model="gpt-5.6-luna"',
      "-c",
      'agents.default_subagent_reasoning_effort="max"',
      "-c",
      "agents.job_max_runtime_seconds=900",
      "--help",
    ]),
  ]);
  for (const result of [version, help, features, config]) {
    if (result.exit_code !== 0 && result.stderr.trim()) warnings.push(redactText(result.stderr.trim()).slice(-500));
  }
  const featureLines = parseFeatureLines(features.stdout);
  const multiAgent = featureLines.find((line) => line.name === "multi_agent");
  const multiAgentV2 = featureLines.find((line) => line.name === "multi_agent_v2");
  const configSupported = config.exit_code === 0;
  const subagentConfig = Object.fromEntries(SUBAGENT_CONFIG_KEYS.map((key) => [key, configSupported])) as unknown as SubagentConfigCapabilities;
  const supportsEphemeral = help.stdout.includes("--ephemeral");
  const supportsJson = help.stdout.includes("--json");
  const supportsSandbox = help.stdout.includes("--sandbox");
  const supportsApproval = help.stdout.includes("--ask-for-approval") || configSupported;
  const supportsCwd = help.stdout.includes("--cd");
  const supportsMultiAgent = multiAgent?.stage !== "removed" && multiAgent?.enabled === true;
  const nativeSubagents = !supportsMultiAgent ? "not_available" : configSupported ? "available" : "degraded";
  return {
    executable,
    version: parseVersion(`${version.stdout}\n${version.stderr}`),
    detected_at: new Date().toISOString(),
    supports_ephemeral_exec: supportsEphemeral,
    supports_json_events: supportsJson,
    supports_exec_sandbox: supportsSandbox,
    supports_exec_approval_policy: supportsApproval,
    supports_exec_cwd: supportsCwd,
    supports_multi_agent_feature: supportsMultiAgent,
    multi_agent_feature_state: supportsMultiAgent ? "enabled" : multiAgent ? "disabled" : "unavailable",
    multi_agent_v2_state: multiAgentV2 ? (multiAgentV2.enabled ? "enabled" : "disabled") : "unavailable",
    subagent_config: subagentConfig,
    native_subagents: nativeSubagents,
    warnings,
  };
}

export class EphemeralCodexRunner {
  readonly #executable: string;
  readonly #clock: () => Date;
  readonly #spawnProcess: typeof spawn;
  readonly #capabilityProbe: EphemeralCodexRunnerOptions["capabilityProbe"];
  #capabilities: CodexCapabilitySnapshot | null = null;
  #capabilityPromise: Promise<CodexCapabilitySnapshot> | null = null;

  constructor(options: EphemeralCodexRunnerOptions = {}) {
    this.#executable = options.executable ?? resolveCodexExecutable();
    this.#clock = options.clock ?? (() => new Date());
    this.#spawnProcess = options.spawnProcess ?? spawn;
    this.#capabilityProbe = options.capabilityProbe;
  }

  capabilities(): CodexCapabilitySnapshot | null {
    return this.#capabilities ? structuredClone(this.#capabilities) : null;
  }

  async detectCapabilities(): Promise<CodexCapabilitySnapshot> {
    if (this.#capabilities) return this.capabilities()!;
    if (!this.#capabilityPromise) {
      this.#capabilityPromise = detectCodexCapabilities({
        executable: this.#executable,
        clock: this.#clock,
        spawnProcess: this.#spawnProcess,
        ...(this.#capabilityProbe ? { capabilityProbe: this.#capabilityProbe } : {}),
      });
    }
    const promise = this.#capabilityPromise;
    try {
      this.#capabilities = await promise;
      return this.capabilities()!;
    } catch (error) {
      if (this.#capabilityPromise === promise) this.#capabilityPromise = null;
      throw error;
    }
  }

  async run(request: EphemeralCodexRunRequest): Promise<EphemeralCodexResult> {
    if (this.#capabilities === null) await this.detectCapabilities();
    const primary = await this.#runOnce(request, true);
    if (
      primary.status === "failed" &&
      primary.events.length === 0 &&
      /(?:unknown|unrecognized|invalid|unsupported).{0,80}(?:config|agent|multi[_-]?agent)/i.test(primary.stderr)
    ) {
      const degraded = await this.#runOnce(request, false);
      degraded.subagents.support = "degraded";
      return degraded;
    }
    return primary;
  }

  async #runOnce(request: EphemeralCodexRunRequest, includeSubagentConfig: boolean): Promise<EphemeralCodexResult> {
    const started = this.#clock();
    const startMs = Date.now();
    const context = request.timing_context ?? {};
    const submittedMs = context.submitted_at ? Date.parse(context.submitted_at) : startMs;
    const originMs = Number.isFinite(submittedMs) ? submittedMs : startMs;
    const prepareSpawnMs = Date.now();
    const events: EphemeralRunnerEvent[] = [];
    const parser = new JsonlEventParser();
    const subagentIds = new Set<string>();
    let anonymousSubagents = 0;
    let stoppedSubagents = 0;
    let firstEventMs: number | null = null;
    let firstAnswerMs: number | null = null;
    let firstSessionMs: number | null = null;
    let processSpawnCalledMs: number | null = null;
    let processCreatedMs: number | null = null;
    let streamsReadyMs: number | null = null;
    let terminalStatus: string | null = null;
    let stderr = "";
    let child: ChildProcess | null = null;
    let aborted = request.signal?.aborted === true;
    let abortHandler: (() => void) | null = null;
    const record = (raw: Record<string, unknown>): void => {
      const event = normalizeEphemeralEvent(raw, this.#clock);
      events.push(event);
      if (events.length > 512) events.splice(0, events.length - 512);
      if (firstEventMs === null) firstEventMs = Date.now();
      if (firstSessionMs === null && hasSessionIdentity(raw)) firstSessionMs = Date.now();
      if (event.text && firstAnswerMs === null) firstAnswerMs = Date.now();
      if (event.subagent?.kind === "started") {
        if (event.subagent.id) subagentIds.add(event.subagent.id);
        else anonymousSubagents += 1;
      } else if (event.subagent?.kind === "stopped") {
        if (event.subagent.id) subagentIds.delete(event.subagent.id);
        else anonymousSubagents = Math.max(0, anonymousSubagents - 1);
        stoppedSubagents += 1;
      }
      if (event.type.toLowerCase().includes("turn.completed")) {
        const turn = isRecord(raw.turn) ? raw.turn : null;
        terminalStatus = stringValue(raw.status) ?? stringValue(turn?.status) ?? "completed";
      }
      try { request.onEvent?.(event); } catch { /* task projection must not break the child */ }
    };
    const appendStderr = (chunk: Buffer): void => {
      stderr = (stderr + redactText(chunk.toString("utf8"))).slice(-MAX_STDERR_CHARS);
    };
    const phaseTimings = (finalMs: number): EphemeralPhaseTimings => {
      const timestamp = (value: number | null): string | null => value === null ? null : new Date(value).toISOString();
      const delta = (from: number | null, to: number | null): number | null =>
        from === null || to === null ? null : Math.max(0, to - from);
      const acquiredMs = context.worker_acquired_at ? Date.parse(context.worker_acquired_at) : null;
      const validAcquiredMs = acquiredMs !== null && Number.isFinite(acquiredMs) ? acquiredMs : null;
      const createdMs = processCreatedMs ?? null;
      return {
        submitted_at: context.submitted_at ?? null,
        task_created_at: context.task_created_at ?? null,
        queue_entered_at: context.queue_entered_at ?? null,
        worker_acquired_at: context.worker_acquired_at ?? null,
        dispatch_at: context.dispatch_at ?? null,
        prepare_spawn_at: timestamp(prepareSpawnMs)!,
        process_spawn_called_at: timestamp(processSpawnCalledMs ?? prepareSpawnMs)!,
        process_created_at: timestamp(createdMs),
        streams_ready_at: timestamp(streamsReadyMs),
        first_json_at: timestamp(firstEventMs),
        first_session_at: timestamp(firstSessionMs),
        first_content_at: timestamp(firstAnswerMs),
        final_response_at: timestamp(finalMs)!,
        queue_wait_ms: delta(originMs, validAcquiredMs),
        worker_dispatch_ms: delta(validAcquiredMs, prepareSpawnMs),
        process_spawn_ms: delta(processSpawnCalledMs, createdMs),
        codex_bootstrap_ms: delta(createdMs, firstEventMs),
        first_json_ms: delta(originMs, firstEventMs),
        first_content_ms: delta(originMs, firstAnswerMs),
        total_ms: Math.max(0, finalMs - originMs),
      };
    };
    try {
      processSpawnCalledMs = Date.now();
      child = this.#spawnProcess(this.#executable, buildEphemeralExecArgs(request, this.#capabilities, includeSubagentConfig), {
        cwd: request.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
        env: process.env,
      });
      child.once("spawn", () => { if (processCreatedMs === null) processCreatedMs = Date.now(); });
      abortHandler = (): void => {
        aborted = true;
        if (child && child.exitCode === null && child.signalCode === null) child.kill();
      };
      if (request.signal) {
        if (request.signal.aborted) abortHandler();
        else request.signal.addEventListener("abort", abortHandler, { once: true });
      }
      child.stdout?.on("data", (chunk: Buffer) => {
        for (const raw of parser.push(chunk)) record(raw);
      });
      child.stderr?.on("data", appendStderr);
      child.on("error", (error: Error) => appendStderr(Buffer.from(error.message, "utf8")));
      streamsReadyMs = Date.now();
      const exit = await waitForChild(child, 24 * 60 * 60 * 1_000);
      for (const raw of parser.finish()) record(raw);
      if (parser.errors.length > 0 && !stderr) stderr = parser.errors.join("; ");
      const finalAnswer = extractFinalAnswer(events);
      const completed = terminalStatus ? /^(complete|completed|success|succeeded)$/i.test(terminalStatus) : exit.code === 0;
      const status = aborted
        ? "interrupted"
        : completed
          ? "completed"
          : exit.signal !== null && /(?:INT|TERM|KILL)/i.test(exit.signal)
            ? "interrupted"
            : "failed";
      const completedAtMs = Date.now();
      const completedAt = this.#clock();
      return {
        status,
        final_answer: finalAnswer,
        exit_code: exit.code,
        signal: exit.signal,
        stderr,
        events: [...events],
        timings: {
          started_at: started.toISOString(),
          first_event_at: firstEventMs === null ? null : new Date(firstEventMs).toISOString(),
          first_answer_at: firstAnswerMs === null ? null : new Date(firstAnswerMs).toISOString(),
          completed_at: completedAt.toISOString(),
          startup_ms: firstEventMs === null ? null : firstEventMs - startMs,
          time_to_first_event_ms: firstEventMs === null ? null : firstEventMs - startMs,
          time_to_first_answer_ms: firstAnswerMs === null ? null : firstAnswerMs - startMs,
          total_ms: completedAtMs - startMs,
          phase_timings: phaseTimings(completedAtMs),
        },
        subagents: {
          support: includeSubagentConfig && this.#capabilities?.native_subagents === "available" ? "native" : "degraded",
          reported: events.some((event) => event.subagent !== null),
          active: subagentIds.size + anonymousSubagents,
          max_concurrent: Math.min(DEFAULT_SUBAGENT_LIMIT, request.max_subagents ?? DEFAULT_SUBAGENT_LIMIT),
          started: events.filter((event) => event.subagent?.kind === "started").length,
          stopped: stoppedSubagents,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const completedAtMs = Date.now();
      const completedAt = this.#clock();
      return {
        status: aborted ? "interrupted" : "failed",
        final_answer: extractFinalAnswer(events),
        exit_code: child?.exitCode ?? null,
        signal: child?.signalCode ?? null,
        stderr: stderr || redactText(message).slice(0, MAX_STDERR_CHARS),
        events: [...events],
        timings: {
          started_at: started.toISOString(),
          first_event_at: firstEventMs === null ? null : new Date(firstEventMs).toISOString(),
          first_answer_at: firstAnswerMs === null ? null : new Date(firstAnswerMs).toISOString(),
          completed_at: completedAt.toISOString(),
          startup_ms: firstEventMs === null ? null : firstEventMs - startMs,
          time_to_first_event_ms: firstEventMs === null ? null : firstEventMs - startMs,
          time_to_first_answer_ms: firstAnswerMs === null ? null : firstAnswerMs - startMs,
          total_ms: completedAtMs - startMs,
          phase_timings: phaseTimings(completedAtMs),
        },
        subagents: {
          support: includeSubagentConfig ? "native" : "degraded",
          reported: events.some((event) => event.subagent !== null),
          active: subagentIds.size + anonymousSubagents,
          max_concurrent: Math.min(DEFAULT_SUBAGENT_LIMIT, request.max_subagents ?? DEFAULT_SUBAGENT_LIMIT),
          started: events.filter((event) => event.subagent?.kind === "started").length,
          stopped: stoppedSubagents,
        },
      };
    } finally {
      if (request.signal && abortHandler) request.signal.removeEventListener("abort", abortHandler);
      if (child && child.exitCode === null && child.signalCode === null && aborted) child.kill();
    }
  }
}
