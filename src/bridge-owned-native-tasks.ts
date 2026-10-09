import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { TaskRecord } from "./task-manager.js";
import { readTaskManagerSnapshot } from "./task-manager.js";
import type { TunnelHealthView } from "./tunnel-health.js";

const TUNNEL_STATE_ENV = "LOCAL_CODEX_BRIDGE_TUNNEL_STATE_FILE";
const ACTIVE_NATIVE_STATUSES = new Set<TaskRecord["status"]>([
  "WAITING",
  "STARTING",
  "RUNNING",
  "RETRYING",
  "NEED_CONFIRM",
]);
const V6_TUNNEL_STATUS_PORTS = Array.from({ length: 10 }, (_, index) => 37_930 + index);
const MAX_PROJECTED_TASKS = 32;

export interface BridgeOwnedNativeTaskSource {
  readonly taskFilePath: string;
  readonly tunnelStateFilePath: string;
  readonly ownershipFilePath: string;
  readonly pidFilePath: string;
  readonly expectedPackageRoot: string;
  readonly hostStatusPort: number | null;
  readonly isProcessAlive?: (pid: number) => boolean;
  /** Test seam; production probes the owned plugin-child status endpoint. */
  readonly pluginRuntimeIsLive?: () => Promise<boolean>;
}

interface UnknownRecord {
  [key: string]: unknown;
}

interface TunnelOwnership {
  pid: number;
  executablePath: string;
  profilePath: string;
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function absolutePath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || !isAbsolute(value)) {
    return null;
  }
  try {
    return resolve(value);
  } catch {
    return null;
  }
}

function port(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 65_535) {
    return null;
  }
  return value;
}

function configuredHostStatusPort(environment: NodeJS.ProcessEnv): number | null {
  const value = environment.LOCAL_CODEX_BRIDGE_STATUS_PORT?.trim();
  if (!value || !/^\d+$/.test(value)) return null;
  return port(Number(value));
}

/**
 * Resolve the companion task projection produced by the V6 Tunnel's
 * plugin-child Bridge. The path is derived only from the current V6 tunnel
 * state file; no legacy/V5 path is guessed.
 */
export function resolveBridgeOwnedNativeTaskSource(
  environment: NodeJS.ProcessEnv = process.env,
): BridgeOwnedNativeTaskSource | null {
  const stateFile = absolutePath(environment[TUNNEL_STATE_ENV]?.trim());
  if (!stateFile) {
    return null;
  }
  const root = dirname(dirname(stateFile));
  const tunnelRoot = join(root, "tunnel-bridge");
  return {
    taskFilePath: join(tunnelRoot, "task_records.json"),
    tunnelStateFilePath: stateFile,
    ownershipFilePath: join(dirname(stateFile), "desktop-ownership.json"),
    pidFilePath: join(dirname(stateFile), "tunnel-client.pid"),
    expectedPackageRoot: resolve(process.cwd()),
    hostStatusPort: configuredHostStatusPort(environment),
  };
}

/**
 * The desktop UI owns the read-only projection of the Tunnel child. The
 * Tunnel child itself uses the companion task file as its own task store and
 * must not inject this reader, otherwise the two local status servers would
 * probe each other recursively.
 */
export function isBridgeOwnedNativeProjectionHost(
  taskFilePath: string,
  source: BridgeOwnedNativeTaskSource | null,
): boolean {
  const current = absolutePath(taskFilePath);
  const companion = source ? absolutePath(source.taskFilePath) : null;
  return current !== null && companion !== null && current.toLowerCase() !== companion.toLowerCase();
}

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readJson(path: string): UnknownRecord | null {
  try {
    return record(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    return null;
  }
}

function readTunnelOwnership(
  source: BridgeOwnedNativeTaskSource,
  isProcessAlive: (pid: number) => boolean,
): TunnelOwnership | null {
  const state = readJson(source.tunnelStateFilePath);
  const stateStatus = stringValue(state?.status)?.toLowerCase();
  const registration = stringValue(state?.registration)?.toLowerCase();
  const statePid = positiveInteger(state?.process_id);
  if (stateStatus !== "running" || registration !== "ready" || statePid === null) {
    return null;
  }

  const ownership = readJson(source.ownershipFilePath);
  const tunnelOwner = record(ownership?.tunnel);
  const ownerPid = positiveInteger(tunnelOwner?.pid);
  const executablePath = absolutePath(tunnelOwner?.executable_path);
  const profilePath = absolutePath(tunnelOwner?.profile);
  const expectedExecutable = absolutePath(join(source.expectedPackageRoot, "tunnel-client.exe"));
  const expectedProfile = absolutePath(join(dirname(source.tunnelStateFilePath), "tunnel-profile.yaml"));
  if (
    ownerPid === null ||
    ownerPid !== statePid ||
    executablePath === null ||
    expectedExecutable === null ||
    executablePath.toLowerCase() !== expectedExecutable.toLowerCase() ||
    profilePath === null ||
    expectedProfile === null ||
    profilePath.toLowerCase() !== expectedProfile.toLowerCase() ||
    !isProcessAlive(ownerPid)
  ) {
    return null;
  }

  try {
    const pidFile = readFileSync(source.pidFilePath, "utf8").trim();
    if (pidFile !== String(ownerPid)) return null;
  } catch {
    return null;
  }
  return { pid: ownerPid, executablePath, profilePath };
}

async function fetchPluginStatus(portNumber: number): Promise<UnknownRecord | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150);
  try {
    const response = await fetch(`http://127.0.0.1:${portNumber}/api/status`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return record(await response.json() as unknown);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probePluginRuntime(
  source: BridgeOwnedNativeTaskSource,
  isProcessAlive: (pid: number) => boolean,
): Promise<boolean> {
  if (source.hostStatusPort === null) return false;
  const ports = V6_TUNNEL_STATUS_PORTS.filter((candidate) => candidate !== source.hostStatusPort);
  const statuses = await Promise.all(ports.map((candidate) => fetchPluginStatus(candidate)));
  for (const status of statuses) {
    const bridge = record(status?.bridge);
    const pid = positiveInteger(bridge?.pid);
    const workspace = absolutePath(bridge?.workspace);
    const expectedWorkspace = absolutePath(source.expectedPackageRoot);
    const bridgeStatus = stringValue(bridge?.status)?.toLowerCase();
    if (
      pid !== null &&
      pid !== process.pid &&
      bridgeStatus === "running" &&
      workspace !== null &&
      expectedWorkspace !== null &&
      workspace.toLowerCase() === expectedWorkspace.toLowerCase() &&
      isProcessAlive(pid)
    ) {
      return true;
    }
  }
  return false;
}

function isBridgeOwnedNativeTask(task: TaskRecord): boolean {
  if (
    task.execution_source !== "external/native" ||
    !ACTIVE_NATIVE_STATUSES.has(task.status) ||
    task.worker_id !== null ||
    task.thread_id === null ||
    task.turn_id === null
  ) {
    return false;
  }
  return task.fingerprint === `runtime:${task.thread_id}:${task.turn_id}`;
}

/**
 * Return only active Native turns owned by the current V6 plugin runtime.
 *
 * The task file is not trusted by itself. This read first validates the
 * current V6 Tunnel state, exact Tunnel executable/profile ownership and PID,
 * then proves that the companion plugin-child status server is alive in the
 * same package. A missing/stale task file or a dead child therefore fails
 * closed without creating a task or touching any process.
 */
export async function readBridgeOwnedNativeActiveTasks(
  source: BridgeOwnedNativeTaskSource | null | undefined,
  tunnel: Pick<TunnelHealthView, "status" | "registration">,
): Promise<TaskRecord[]> {
  if (
    !source ||
    tunnel.status !== "running" ||
    tunnel.registration !== "ready"
  ) {
    return [];
  }
  const taskFilePath = absolutePath(source.taskFilePath);
  const stateFilePath = absolutePath(source.tunnelStateFilePath);
  const ownershipFilePath = absolutePath(source.ownershipFilePath);
  const pidFilePath = absolutePath(source.pidFilePath);
  if (!taskFilePath || !stateFilePath || !ownershipFilePath || !pidFilePath) {
    return [];
  }
  const isProcessAlive = source.isProcessAlive ?? defaultProcessAlive;
  const ownership = readTunnelOwnership(source, isProcessAlive);
  if (!ownership) return [];
  const pluginLive = source.pluginRuntimeIsLive
    ? await source.pluginRuntimeIsLive().catch(() => false)
    : await probePluginRuntime(source, isProcessAlive);
  if (!pluginLive) return [];

  const snapshot = readTaskManagerSnapshot(taskFilePath);
  if (!snapshot) return [];
  return snapshot.tasks
    .filter(isBridgeOwnedNativeTask)
    .slice(0, MAX_PROJECTED_TASKS);
}
