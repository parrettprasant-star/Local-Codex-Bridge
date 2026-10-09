export const MAX_LUNA_WORKERS = 5;

export type WorkerStatus = "IDLE" | "RUNNING" | "RETRYING" | "BLOCKED";

export interface WorkerSlot {
  worker_id: string;
  status: WorkerStatus;
  task_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  phase: string;
  runtime: string;
  policy_model: string | null;
  policy_effort: string | null;
  requested_model: string | null;
  requested_effort: string | null;
  observed_model: string | null;
  observed_effort: string | null;
  write_claim: string | null;
  last_event: string | null;
  error: string | null;
  retry_count: number;
}

function emptySlot(index: number, runtime = "managed-app-server"): WorkerSlot {
  return {
    worker_id: `luna-${index + 1}`,
    status: "IDLE",
    task_id: null,
    thread_id: null,
    turn_id: null,
    phase: "idle",
    runtime,
    policy_model: null,
    policy_effort: null,
    requested_model: null,
    requested_effort: null,
    observed_model: null,
    observed_effort: null,
    write_claim: null,
    last_event: null,
    error: null,
    retry_count: 0,
  };
}

export class WorkerPool {
  readonly maxWorkers: number;
  readonly #slots: WorkerSlot[];
  readonly #runtime: string;

  constructor(maxWorkers = MAX_LUNA_WORKERS, runtime = "managed-app-server") {
    if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
      throw new Error("maxWorkers must be a positive integer");
    }
    if (!runtime || runtime.length > 100) {
      throw new Error("runtime must be a non-empty string of at most 100 characters");
    }
    this.maxWorkers = maxWorkers;
    this.#runtime = runtime;
    this.#slots = Array.from({ length: maxWorkers }, (_, index) => emptySlot(index, runtime));
  }

  acquire(taskId: string): WorkerSlot | null {
    const slot = this.#slots.find((candidate) => candidate.status === "IDLE");
    if (!slot) return null;
    slot.status = "RUNNING";
    slot.task_id = taskId;
    slot.phase = "starting";
    slot.last_event = new Date().toISOString();
    return this.get(slot.worker_id);
  }

  get(workerId: string): WorkerSlot {
    const slot = this.#slots.find((candidate) => candidate.worker_id === workerId);
    if (!slot) throw new Error(`Unknown worker: ${workerId}`);
    return cloneSlot(slot);
  }

  update(workerId: string, patch: Partial<Omit<WorkerSlot, "worker_id">>): WorkerSlot {
    const index = this.#slots.findIndex((candidate) => candidate.worker_id === workerId);
    if (index < 0) throw new Error(`Unknown worker: ${workerId}`);
    const slot = this.#slots[index]!;
    Object.assign(slot, patch, { last_event: patch.last_event ?? new Date().toISOString() });
    return cloneSlot(slot);
  }

  release(workerId: string): void {
    const index = this.#slots.findIndex((candidate) => candidate.worker_id === workerId);
    if (index < 0) return;
    this.#slots[index] = emptySlot(index, this.#runtime);
  }

  runningCount(): number {
    return this.#slots.filter((slot) => slot.status === "RUNNING" || slot.status === "RETRYING").length;
  }

  snapshot(): WorkerSlot[] {
    return this.#slots.map(cloneSlot);
  }
}

function cloneSlot(slot: WorkerSlot): WorkerSlot {
  return { ...slot };
}
