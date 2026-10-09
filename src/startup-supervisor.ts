import { randomUUID } from "node:crypto";

export const STARTUP_PHASES = [
  "STOPPED",
  "BOOTSTRAPPING",
  "HOST_STARTING",
  "HOST_READY",
  "WEBVIEW_STARTING",
  "UI_READY",
  "TUNNEL_STARTING",
  "TUNNEL_READY",
  "PLUGIN_READY",
  "READY",
  "DEGRADED",
  "RECOVERING",
  "FAILED",
] as const;

export type StartupPhase = (typeof STARTUP_PHASES)[number];
export type ComponentHealthState =
  | "stopped"
  | "starting"
  | "ready"
  | "degraded"
  | "recovering"
  | "failed";

export interface ComponentHealth {
  state: ComponentHealthState;
  generation: string;
  owner_pid: number | null;
  started_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_reason: string | null;
}

export interface StartupTimelineEntry {
  at: string;
  phase: StartupPhase;
  message: string;
}

export interface StartupSnapshot {
  generation: string;
  phase: StartupPhase;
  updated_at: string;
  components: Record<string, ComponentHealth>;
  timeline: StartupTimelineEntry[];
}

const MAX_TIMELINE = 100;

function now(): string {
  return new Date().toISOString();
}

function cloneComponent(value: ComponentHealth): ComponentHealth {
  return { ...value };
}

export class StartupSupervisor {
  readonly generation: string;
  #phase: StartupPhase = "BOOTSTRAPPING";
  #updatedAt = now();
  readonly #components = new Map<string, ComponentHealth>();
  readonly #timeline: StartupTimelineEntry[] = [];

  constructor(generation: string = randomUUID()) {
    this.generation = generation;
    this.transition("BOOTSTRAPPING", "Bridge startup generation created");
  }

  phase(): StartupPhase {
    return this.#phase;
  }

  transition(phase: StartupPhase, message: string): void {
    this.#phase = phase;
    this.#updatedAt = now();
    this.#timeline.push({ at: this.#updatedAt, phase, message: message.slice(0, 500) });
    if (this.#timeline.length > MAX_TIMELINE) this.#timeline.splice(0, this.#timeline.length - MAX_TIMELINE);
  }

  component(
    name: string,
    state: ComponentHealthState,
    input: Partial<Omit<ComponentHealth, "state" | "generation">> = {},
  ): void {
    const previous = this.#components.get(name);
    const at = now();
    const health: ComponentHealth = {
      state,
      generation: this.generation,
      owner_pid: input.owner_pid ?? previous?.owner_pid ?? null,
      started_at: input.started_at ?? previous?.started_at ?? (state === "starting" ? at : null),
      last_success_at: input.last_success_at ?? previous?.last_success_at ?? (state === "ready" ? at : null),
      last_failure_at: input.last_failure_at ?? previous?.last_failure_at ?? (state === "failed" ? at : null),
      failure_reason: input.failure_reason ?? (state === "failed" ? previous?.failure_reason ?? "unknown" : null),
    };
    this.#components.set(name, health);
    this.#updatedAt = at;
  }

  snapshot(): StartupSnapshot {
    const components: Record<string, ComponentHealth> = {};
    for (const [name, value] of this.#components) components[name] = cloneComponent(value);
    return {
      generation: this.generation,
      phase: this.#phase,
      updated_at: this.#updatedAt,
      components,
      timeline: this.#timeline.map((entry) => ({ ...entry })),
    };
  }
}
