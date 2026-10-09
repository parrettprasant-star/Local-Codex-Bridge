import { readFileSync } from "node:fs";

const MAX_ERROR_LENGTH = 500;

export interface TunnelHealthView {
  status: "running" | "starting" | "not_configured" | "error" | "stopped";
  registration: "ready" | "registering" | "failed" | "not_registered";
  active_tunnel_id: string | null;
  client_version: string | null;
  last_registration_error: string | null;
  health_url: string | null;
  parent_pid: number | null;
  mcp_child_pid: number | null;
  parent_process_alive: boolean | null;
  mcp_child_alive: boolean | null;
  health_probe: "ok" | "failed" | "unknown";
  transport_status: "ready" | "closed" | "failed" | "unknown";
  transport_last_error: string | null;
  restart_attempt: number | null;
  last_initialize_at: string | null;
  last_tools_list_at: string | null;
  last_disconnect_reason: string | null;
  state_updated_at: string | null;
}

function safeText(value: unknown, maxLength = MAX_ERROR_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function isTunnelId(value: string | null): value is string {
  return value !== null && /^tunnel_[0-9a-f]{32}$/.test(value);
}

function positivePid(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function transportStatus(value: unknown): TunnelHealthView["transport_status"] {
  return value === "ready" || value === "closed" || value === "failed"
    ? value
    : "unknown";
}

function healthProbe(value: unknown): TunnelHealthView["health_probe"] {
  return value === "ok" || value === "failed" ? value : "unknown";
}

function defaultHealth(): TunnelHealthView {
  const configuredId = safeText(process.env.LOCAL_CODEX_BRIDGE_TUNNEL_ID, 64);
  return {
    status: configuredId ? "starting" : "not_configured",
    registration: configuredId ? "registering" : "not_registered",
    active_tunnel_id: isTunnelId(configuredId) ? configuredId : null,
    client_version: null,
    last_registration_error: null,
    health_url: null,
    parent_pid: null,
    mcp_child_pid: null,
    parent_process_alive: null,
    mcp_child_alive: null,
    health_probe: "unknown",
    transport_status: "unknown",
    transport_last_error: null,
    restart_attempt: null,
    last_initialize_at: null,
    last_tools_list_at: null,
    last_disconnect_reason: null,
    state_updated_at: null,
  };
}

export function readTunnelHealth(): TunnelHealthView {
  const fallback = defaultHealth();
  const stateFile = safeText(process.env.LOCAL_CODEX_BRIDGE_TUNNEL_STATE_FILE, 4_096);
  if (!stateFile) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
    const status = safeText(parsed.status, 32);
    const registration = safeText(parsed.registration, 32);
    const tunnelId = safeText(parsed.tunnel_id, 64);
    return {
      status: status === "running" || status === "starting" || status === "error" || status === "stopped"
        ? status
        : fallback.status,
      registration: registration === "ready" || registration === "registering" || registration === "failed" || registration === "not_registered"
        ? registration
        : fallback.registration,
      active_tunnel_id: isTunnelId(tunnelId) ? tunnelId : fallback.active_tunnel_id,
      client_version: safeText(parsed.client_version, 128),
      last_registration_error: safeText(parsed.last_error),
      health_url: safeText(parsed.health_url, 4_096),
      parent_pid: positivePid(parsed.parent_pid) ?? positivePid(parsed.process_id),
      mcp_child_pid: positivePid(parsed.mcp_child_pid),
      parent_process_alive: null,
      mcp_child_alive: null,
      health_probe: healthProbe(parsed.health_probe),
      transport_status: transportStatus(parsed.transport_status),
      transport_last_error: safeText(parsed.transport_last_error),
      restart_attempt: positivePid(parsed.restart_attempt),
      last_initialize_at: safeText(parsed.last_initialize_at, 100),
      last_tools_list_at: safeText(parsed.last_tools_list_at, 100),
      last_disconnect_reason: safeText(parsed.last_disconnect_reason),
      state_updated_at: safeText(parsed.updated_at, 100),
    };
  } catch {
    return {
      ...fallback,
      status: "error",
      registration: "failed",
      last_registration_error: "tunnel_state_unavailable",
      health_probe: "failed",
    };
  }
}

function processIsAlive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function failedHealth(
  value: TunnelHealthView,
  reason: string,
  parentAlive: boolean,
  childAlive: boolean,
): TunnelHealthView {
  return {
    ...value,
    status: "error",
    registration: "failed",
    parent_process_alive: parentAlive,
    mcp_child_alive: childAlive,
    health_probe: "failed",
    last_registration_error: reason,
  };
}

/**
 * Resolve a persisted Tunnel snapshot against the live process and health
 * state. The default production path is strict; injected test readers may
 * opt out of OS/network probes while preserving the same shape.
 */
export async function probeTunnelHealth(
  value: TunnelHealthView = readTunnelHealth(),
  strict = true,
): Promise<TunnelHealthView> {
  if (!strict) {
    return {
      ...value,
      health_probe: value.status === "running" && value.registration === "ready" ? "ok" : value.health_probe,
    };
  }
  const parentAlive = processIsAlive(value.parent_pid);
  const childAlive = processIsAlive(value.mcp_child_pid);
  if (value.status === "running" && value.registration === "ready") {
    if (value.parent_pid === null || !parentAlive) {
      return failedHealth(value, "tunnel_parent_not_alive", parentAlive, childAlive);
    }
    if (value.mcp_child_pid === null || !childAlive) {
      return failedHealth(value, "mcp_stdio_child_not_alive", parentAlive, childAlive);
    }
    if (value.transport_status !== "ready") {
      return failedHealth(value, "mcp_transport_not_ready", parentAlive, childAlive);
    }
    if (!value.health_url) {
      return failedHealth(value, "tunnel_health_url_missing", parentAlive, childAlive);
    }
    try {
      const response = await fetch(value.health_url.replace(/\/$/, "") + "/readyz", {
        cache: "no-store",
        signal: AbortSignal.timeout(1_500),
      });
      if (!response.ok) {
        return failedHealth(value, "tunnel_health_probe_failed", parentAlive, childAlive);
      }
    } catch {
      return failedHealth(value, "tunnel_health_probe_failed", parentAlive, childAlive);
    }
    return {
      ...value,
      parent_process_alive: true,
      mcp_child_alive: true,
      health_probe: "ok",
    };
  }
  return {
    ...value,
    parent_process_alive: value.parent_pid === null ? null : parentAlive,
    mcp_child_alive: value.mcp_child_pid === null ? null : childAlive,
    health_probe: value.status === "error" ? "failed" : "unknown",
  };
}
