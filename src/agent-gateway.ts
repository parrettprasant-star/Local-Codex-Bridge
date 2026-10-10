import { normalizeLocalAbsolutePath } from "./local-path.js";

import {
  sanitizeForTransport,
  type RuntimeStore,
} from "./runtime.js";
import type {
  ResultManifest,
} from "./result-manifest.js";
import type {
  TaskLifecycle,
  TaskManager,
  TaskRecord,
} from "./task-manager.js";
import {
  ProjectRegistry,
} from "./project-registry.js";
import { ResultService } from "./result-service.js";
import {
  WorkingDirectoryResolver,
  normalizeRequiredOutputPaths,
  stripOuterWindowsPathQuotes,
} from "./working-directory.js";

export const CODEX_AGENT_ID = "codex_local";

const MAX_INSTRUCTION_CHARS = 200_000;
const MAX_CWD_CHARS = 1_000;
const MAX_TITLE_CHARS = 120;
const MAX_AGENT_ID_CHARS = 100;

export type AgentProviderType = "codex" | "work" | "other";
export type AgentProviderStatus =
  | "ready"
  | "starting"
  | "running"
  | "draining"
  | "unavailable";
export type AgentHealthState =
  | "healthy"
  | "degraded"
  | "unhealthy"
  | "unknown";

export interface AgentProviderDescriptor {
  id: string;
  type: AgentProviderType;
  name: string;
  capabilities: readonly string[];
  status: AgentProviderStatus;
  health: {
    state: AgentHealthState;
    checked_at: string;
    reason?: string;
  };
  execution_scope: {
    owns_processes: boolean;
    owns_threads: boolean;
    supported_sources: readonly string[];
  };
}

export interface AgentTaskRequest {
  instruction: string;
  cwd: string;
  title?: string;
  agent_id: string;
  project_id?: string;
  required_outputs?: string[];
}

export type AgentTaskStatus =
  | "queued"
  | "starting"
  | "running"
  | "waiting_user"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "recovery_required"
  | "blocked";

export interface AgentTaskResponse {
  source: "local_codex_bridge_agent_gateway";
  accepted: boolean;
  agent_id: string;
  agent: {
    id: string;
    type: AgentProviderType;
    name: string;
  };
  status: AgentTaskStatus | "rejected";
  task_id?: string;
  legacy_status?: TaskLifecycle;
  stage?: string;
  progress?: number;
  current_action?: string;
  next_action?: string;
  thread_id?: string | null;
  turn_id?: string | null;
  cwd?: string;
  project_id?: string;
  project_name?: string;
  result_manifest?: ResultManifest | null;
  reason?: string;
  execution_mode?: string;
}

export interface AgentProviderAdapter {
  describe(): AgentProviderDescriptor;
  createTask(request: AgentTaskRequest): Promise<AgentTaskResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredString(
  value: unknown,
  field: string,
  maximum: number,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new Error(`${field} must be at most ${maximum} characters`);
  }
  return normalized;
}

function optionalString(
  value: unknown,
  field: string,
  maximum: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, field, maximum);
}

function validateWindowsCwd(value: string): string {
  return normalizeLocalAbsolutePath(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) {
    throw new Error(`Unknown argument field: ${unknown}`);
  }
}

function parseCreateRequest(value: unknown): AgentTaskRequest {
  const input = asRecord(value, "create_agent_task arguments");
  onlyKeys(input, ["instruction", "cwd", "title", "agent_id", "project_id", "required_outputs"]);
  const instruction = requiredString(input.instruction, "instruction", MAX_INSTRUCTION_CHARS);
  const cwdInput = input.cwd === undefined
    ? undefined
    : validateWindowsCwd(stripOuterWindowsPathQuotes(requiredString(input.cwd, "cwd", MAX_CWD_CHARS)));
  const title = optionalString(input.title, "title", MAX_TITLE_CHARS);
  const agentId = optionalString(input.agent_id, "agent_id", MAX_AGENT_ID_CHARS) ?? CODEX_AGENT_ID;
  const projectId = optionalString(input.project_id, "project_id", MAX_AGENT_ID_CHARS);
  const requiredOutputs = normalizeRequiredOutputPaths(input.required_outputs);
  if (cwdInput === undefined && projectId === undefined) {
    throw new Error("provide either cwd or project_id");
  }
  return {
    instruction,
    cwd: cwdInput ?? "",
    agent_id: agentId,
    ...(title === undefined ? {} : { title }),
    ...(projectId === undefined ? {} : { project_id: projectId }),
    ...(requiredOutputs.length === 0 ? {} : { required_outputs: requiredOutputs }),
  };
}

function parseStatusTaskId(value: unknown): string {
  const input = asRecord(value, "get_task_status arguments");
  onlyKeys(input, ["task_id"]);
  return requiredString(input.task_id, "task_id", 100);
}

function parseOptionalAgentId(value: unknown, label: string): string {
  const input = asRecord(value, label);
  onlyKeys(input, ["agent_id"]);
  return optionalString(input.agent_id, "agent_id", MAX_AGENT_ID_CHARS) ?? CODEX_AGENT_ID;
}

function parseListAgents(value: unknown): boolean {
  const input = asRecord(value, "get_agent_list arguments");
  onlyKeys(input, ["include_unavailable"]);
  if (input.include_unavailable === undefined) {
    return true;
  }
  if (typeof input.include_unavailable !== "boolean") {
    throw new Error("include_unavailable must be a boolean");
  }
  return input.include_unavailable;
}

function parseProjectId(value: unknown, label: string): string {
  const input = asRecord(value, label);
  onlyKeys(input, ["project_id"]);
  return requiredString(input.project_id, "project_id", MAX_AGENT_ID_CHARS);
}

function normalizedAgentStatus(status: TaskLifecycle): AgentTaskStatus {
  switch (status) {
    case "WAITING":
      return "queued";
    case "STARTING":
      return "starting";
    case "RUNNING":
      return "running";
    case "NEED_CONFIRM":
      return "waiting_user";
    case "PAUSED":
      return "paused";
    case "DONE":
    case "COMPLETED":
      return "completed";
    case "FAILED":
    case "BLOCKED":
      return status === "BLOCKED" ? "blocked" : "failed";
    case "INTERRUPTED":
      return "interrupted";
    case "RECOVERY_REQUIRED":
      return "recovery_required";
    case "RETRYING":
      return "starting";
  }
}

function resultManifestForTask(
  task: TaskRecord,
  runtime: RuntimeStore,
): ResultManifest {
  const observation = task.thread_id
    ? runtime.observe(task.thread_id, undefined, 1)
    : null;
  const runtimeResult = observation?.terminal?.final_result ?? null;
  const summary = runtimeResult ?? task.result_summary ?? task.final_answer ?? "";
  return {
    ...task.result_manifest,
    task_id: task.id,
    task_title: task.name,
    execution_status: task.status,
    thread_id: task.thread_id,
    last_turn_id: task.turn_id,
    worker_id: task.worker_id,
    workspace: task.cwd,
    cwd: task.cwd,
    created_at: task.created_at,
    started_at: task.started_at,
    completed_at: task.completed_at,
    result_summary: summary,
    output_files: [...task.output_files],
    output_directories: [...task.output_directories],
    resume_command: task.thread_id ? `codex resume ${task.thread_id}` : null,
  };
}

function taskResponse(
  task: TaskRecord,
  agent: AgentProviderDescriptor,
  runtime: RuntimeStore,
  projectId?: string,
): AgentTaskResponse {
  return {
    source: "local_codex_bridge_agent_gateway",
    accepted: true,
    agent_id: agent.id,
    agent: {
      id: agent.id,
      type: agent.type,
      name: agent.name,
    },
    status: normalizedAgentStatus(task.status),
    task_id: task.id,
    legacy_status: task.status,
    stage: task.stage,
    progress: task.progress,
    current_action: task.current_action,
    next_action: task.next_action,
    thread_id: task.thread_id,
    turn_id: task.turn_id,
    cwd: task.cwd,
    ...(projectId === undefined ? {} : { project_id: projectId }),
    result_manifest: resultManifestForTask(task, runtime),
  };
}

function healthDetails(value: unknown): {
  status: AgentProviderStatus;
  state: AgentHealthState;
  reason?: string;
} {
  const health = isRecord(value) ? value : {};
  const processState = stringValue(health.process_state);
  if (processState === "failed") {
    return { status: "unavailable", state: "unhealthy", reason: stringValue(health.last_error) ?? "app-server failed" };
  }
  if (processState === "starting") {
    return { status: "starting", state: "degraded", reason: "app-server starting" };
  }
  if (processState === "closing") {
    return { status: "draining", state: "degraded", reason: "app-server closing" };
  }
  if (processState === "not_started") {
    return { status: "ready", state: "healthy", reason: "lazy_start" };
  }
  return { status: "ready", state: "healthy" };
}

export class AgentRegistry {
  readonly #providers = new Map<string, AgentProviderAdapter>();

  constructor(providers: readonly AgentProviderAdapter[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  register(provider: AgentProviderAdapter): void {
    const id = provider.describe().id;
    if (this.#providers.has(id)) {
      throw new Error(`Agent provider already registered: ${id}`);
    }
    this.#providers.set(id, provider);
  }

  get(id: string): AgentProviderAdapter | undefined {
    return this.#providers.get(id);
  }

  list(): AgentProviderDescriptor[] {
    return [...this.#providers.values()].map((provider) => provider.describe());
  }
}

export type NativeTurnInvoker = (
  argumentsValue: Record<string, unknown>,
) => Promise<unknown>;

export class CodexAgentProviderAdapter implements AgentProviderAdapter {
  readonly #invokeNativeTurn: NativeTurnInvoker;
  readonly #manager: TaskManager;
  readonly #runtime: RuntimeStore;
  readonly #healthReader: () => unknown;
  readonly #resultService: ResultService;

  constructor(
    invokeNativeTurn: NativeTurnInvoker,
    manager: TaskManager,
    runtime: RuntimeStore,
    healthReader: () => unknown,
  ) {
    this.#invokeNativeTurn = invokeNativeTurn;
    this.#manager = manager;
    this.#runtime = runtime;
    this.#healthReader = healthReader;
    this.#resultService = new ResultService(manager);
  }

  describe(): AgentProviderDescriptor {
    const health = healthDetails(this.#healthReader());
    return {
      id: CODEX_AGENT_ID,
      type: "codex",
      name: "Codex Agent",
      capabilities: ["file_read", "file_write", "terminal", "code_execution"],
      status: health.status,
      health: {
        state: health.state,
        checked_at: new Date().toISOString(),
        ...(health.reason === undefined ? {} : { reason: health.reason }),
      },
      execution_scope: {
        owns_processes: false,
        owns_threads: false,
        supported_sources: ["chatgpt", "manual", "api"],
      },
    };
  }

  async createTask(request: AgentTaskRequest): Promise<AgentTaskResponse> {
    const nativeResult = asRecord(
      await this.#invokeNativeTurn({
        text: request.instruction,
        cwd: request.cwd,
        ...(request.title === undefined ? {} : { title: request.title }),
        ...(request.required_outputs === undefined ? {} : { required_outputs: request.required_outputs }),
        sandbox: "read-only",
        approval_policy: "on-request",
      }),
      "codex_turn result",
    );
    const agent = this.describe();
    if (nativeResult.accepted !== true) {
      return {
        source: "local_codex_bridge_agent_gateway",
        accepted: false,
        agent_id: agent.id,
        agent: { id: agent.id, type: agent.type, name: agent.name },
        status: "rejected",
        reason: stringValue(nativeResult.reason) ?? "Codex Agent rejected the task",
        ...(stringValue(nativeResult.execution_mode)
          ? { execution_mode: stringValue(nativeResult.execution_mode)! }
          : {}),
      };
    }

    const threadId = requiredString(nativeResult.thread_id, "thread_id", 200);
    const turnId = requiredString(nativeResult.turn_id, "turn_id", 200);
    const task = await this.#waitForTask(threadId, turnId);
    const taskWithCwd = task.cwd === request.cwd
      ? task
      : this.#manager.update(task.id, { cwd: request.cwd });
    const withOutputs = request.required_outputs === undefined || request.required_outputs.length === 0
      ? taskWithCwd
      : this.#manager.update(taskWithCwd.id, {
          result_manifest: {
            ...taskWithCwd.result_manifest,
            required_outputs: [...request.required_outputs],
          },
        });
    if (request.required_outputs !== undefined && request.required_outputs.length > 0) {
      try { this.#resultService.finalize(withOutputs.id); } catch { }
    }
    const current = request.required_outputs !== undefined && request.required_outputs.length > 0
      ? this.#manager.get(withOutputs.id)
      : withOutputs;
    const titled = request.title && current.name !== request.title
      ? this.#manager.update(current.id, { name: request.title })
      : current;
    return taskResponse(titled, agent, this.#runtime, request.project_id);
  }

  async #waitForTask(threadId: string, turnId: string): Promise<TaskRecord> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const task = this.#manager.findByThreadTurn(threadId, turnId);
      if (task) {
        return task;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("Codex Agent task mapping was not created by the native runtime");
  }
}

export class AgentGateway {
  readonly registry: AgentRegistry;
  readonly #manager: TaskManager;
  readonly #runtime: RuntimeStore;
  readonly #projects: ProjectRegistry;
  readonly #workingDirectoryResolver: WorkingDirectoryResolver | undefined;

  constructor(
    manager: TaskManager,
    runtime: RuntimeStore,
    registry: AgentRegistry,
    projects: ProjectRegistry = new ProjectRegistry(),
    workingDirectoryResolver?: WorkingDirectoryResolver,
  ) {
    this.#manager = manager;
    this.#runtime = runtime;
    this.registry = registry;
    this.#projects = projects;
    this.#workingDirectoryResolver = workingDirectoryResolver;
  }

  async createAgentTask(value: unknown): Promise<unknown> {
    const parsed = parseCreateRequest(value);
    const project = parsed.project_id === undefined
      ? null
      : this.#projects.resolve(parsed.project_id, parsed.cwd || undefined);
    const resolvedCwd = this.#workingDirectoryResolver
      ? this.#workingDirectoryResolver.resolve(
          project?.cwd ?? parsed.cwd,
          project ? [project.project.root_path] : [],
        ).safe_process_cwd
      : project?.cwd ?? parsed.cwd;
    const request: AgentTaskRequest = {
      ...parsed,
      cwd: resolvedCwd,
    };
    if (project && !project.project.allowed_capabilities.includes("file_read")) {
      return sanitizeForTransport({
        source: "local_codex_bridge_agent_gateway",
        accepted: false,
        agent_id: request.agent_id,
        agent: { id: request.agent_id, type: "codex", name: "Codex Agent" },
        status: "rejected",
        project_id: project.project.project_id,
        project_name: project.project.project_name,
        reason: "project does not allow file_read",
      });
    }
    const provider = this.registry.get(request.agent_id);
    if (!provider) {
      return {
        source: "local_codex_bridge_agent_gateway",
        accepted: false,
        agent_id: request.agent_id,
        agent: { id: request.agent_id, type: "other", name: request.agent_id },
        status: "rejected",
        reason: "Agent provider is not available",
      } satisfies AgentTaskResponse;
    }
    const result = await provider.createTask(request);
    return sanitizeForTransport({
      ...result,
      ...(project === null ? {} : {
        project_id: project.project.project_id,
        project_name: project.project.project_name,
      }),
    }, {
      maxStringChars: 8_000,
      maxDepth: 8,
      maxArrayItems: 100,
      maxObjectKeys: 80,
      totalCharBudget: 80_000,
    });
  }

  listProjects(value: unknown): unknown {
    const input = asRecord(value, "list_projects arguments");
    onlyKeys(input, []);
    return sanitizeForTransport({
      source: "local_codex_bridge_project_registry",
      registry: this.#projects.status(),
      projects: this.#projects.list(),
    });
  }

  getProject(value: unknown): unknown {
    const project = this.#projects.get(parseProjectId(value, "get_project arguments"));
    return sanitizeForTransport({
      source: "local_codex_bridge_project_registry",
      project,
    });
  }

  getAgentList(value: unknown): unknown {
    const includeUnavailable = parseListAgents(value);
    const agents = this.registry
      .list()
      .filter((agent) => includeUnavailable || agent.status !== "unavailable");
    return sanitizeForTransport({
      source: "local_codex_bridge_agent_gateway",
      agents,
    });
  }

  getCapabilities(value: unknown): unknown {
    const agentId = parseOptionalAgentId(value, "get_capabilities arguments");
    const provider = this.registry.get(agentId);
    if (!provider) {
      throw new Error(`Agent provider is not available: ${agentId}`);
    }
    const agent = provider.describe();
    const capabilities = agent.capabilities.map((id) => ({
      id,
      supported: true,
      enabled_in_phase: id === "file_read",
      approval_required: id !== "file_read",
      scope: id === "file_read" ? "project_root" : "not_exposed_in_phase_1_5",
    }));
    return sanitizeForTransport({
      source: "local_codex_bridge_agent_gateway",
      agent_id: agent.id,
      capabilities,
    });
  }

  getTaskStatus(value: unknown): unknown {
    const taskId = parseStatusTaskId(value);
    const task = this.#manager.get(taskId);
    if (task.execution_source !== "external/native") {
      throw new Error("task is not a Codex Agent task");
    }
    const agent = this.registry.get(CODEX_AGENT_ID)?.describe() ?? {
      id: CODEX_AGENT_ID,
      type: "codex" as const,
      name: "Codex Agent",
      capabilities: [],
      status: "unavailable" as const,
      health: { state: "unknown" as const, checked_at: new Date().toISOString() },
      execution_scope: { owns_processes: false, owns_threads: false, supported_sources: [] },
    };
    return sanitizeForTransport(taskResponse(task, agent, this.#runtime), {
      maxStringChars: 8_000,
      maxDepth: 8,
      maxArrayItems: 100,
      maxObjectKeys: 80,
      totalCharBudget: 80_000,
    });
  }
}
