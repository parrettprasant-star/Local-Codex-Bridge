import type { TaskLifecycle, TaskRecord } from "./task-manager.js";

export const DASHBOARD_TERMINAL_STATUSES = [
  "COMPLETED",
  "DONE",
  "FAILED",
  "INTERRUPTED",
] as const satisfies readonly TaskLifecycle[];

export const DASHBOARD_WAITING_STATUSES = [
  "WAITING",
  "RETRYING",
] as const satisfies readonly TaskLifecycle[];

export const DASHBOARD_ACTIVE_STATUSES = [
  "STARTING",
  "RUNNING",
  "NEED_CONFIRM",
] as const satisfies readonly TaskLifecycle[];

export const DASHBOARD_ATTENTION_STATUSES = [
  "RECOVERY_REQUIRED",
  "PAUSED",
  "BLOCKED",
] as const satisfies readonly TaskLifecycle[];

const NATIVE_EXECUTION_STATUSES = [
  "STARTING",
  "RUNNING",
  "RETRYING",
  "NEED_CONFIRM",
] as const satisfies readonly TaskLifecycle[];

const CURRENT_PRIORITY: readonly TaskLifecycle[] = [
  "NEED_CONFIRM",
  "RUNNING",
  "STARTING",
  "RETRYING",
  "WAITING",
  "RECOVERY_REQUIRED",
  "PAUSED",
  "BLOCKED",
];

export type DashboardCurrentKind = "active" | "waiting" | "attention" | "recent_completed" | "idle";

export interface DashboardTaskProjection {
  current: TaskRecord | null;
  current_kind: DashboardCurrentKind;
  active: TaskRecord[];
  waiting: TaskRecord[];
  attention: TaskRecord[];
  recent_completed: TaskRecord[];
  history: TaskRecord[];
  pending_confirmations: TaskRecord[];
  counts: Record<string, number>;
  bridge_active_count: number;
  native_active_count: number;
}

export interface DashboardProjectionContext {
  live_task_ids?: ReadonlySet<string>;
  queued_task_ids?: ReadonlySet<string>;
  waiting_user_task_ids?: ReadonlySet<string>;
}

function includesStatus(
  statuses: readonly TaskLifecycle[],
  status: TaskLifecycle,
): boolean {
  return statuses.includes(status);
}

function compareNewest(left: TaskRecord, right: TaskRecord): number {
  const updated = right.updated_at.localeCompare(left.updated_at);
  return updated !== 0 ? updated : right.created_at.localeCompare(left.created_at);
}

function currentPriority(status: TaskLifecycle): number {
  const index = CURRENT_PRIORITY.indexOf(status);
  return index < 0 ? CURRENT_PRIORITY.length : index;
}

function currentSort(left: TaskRecord, right: TaskRecord): number {
  const priority = currentPriority(left.status) - currentPriority(right.status);
  return priority !== 0 ? priority : compareNewest(left, right);
}

function canonicalKey(task: TaskRecord): string {
  if (
    task.execution_source === "external/native" &&
    task.thread_id !== null &&
    task.turn_id !== null
  ) {
    return `native:${task.thread_id}\u0000${task.turn_id}`;
  }
  return `task:${task.id}`;
}

function deduplicate(tasks: readonly TaskRecord[]): TaskRecord[] {
  const byCanonicalKey = new Map<string, TaskRecord>();
  for (const task of tasks) {
    const key = canonicalKey(task);
    const existing = byCanonicalKey.get(key);
    if (!existing || compareNewest(task, existing) < 0) {
      byCanonicalKey.set(key, task);
    }
  }
  return [...byCanonicalKey.values()].sort(compareNewest);
}

export function buildDashboardTaskProjection(
  tasks: readonly TaskRecord[],
  context?: DashboardProjectionContext,
): DashboardTaskProjection {
  const canonicalTasks = deduplicate(tasks);
  const counts = canonicalTasks.reduce<Record<string, number>>((result, task) => {
    result[task.status] = (result[task.status] ?? 0) + 1;
    return result;
  }, {});
  const hasLiveContext = (task: TaskRecord): boolean =>
    context?.live_task_ids === undefined || context.live_task_ids.has(task.id);
  const hasQueuedContext = (task: TaskRecord): boolean =>
    context?.queued_task_ids === undefined || context.queued_task_ids.has(task.id);
  const hasWaitingUserContext = (task: TaskRecord): boolean =>
    context?.waiting_user_task_ids === undefined || context.waiting_user_task_ids.has(task.id);
  const active = canonicalTasks
    .filter((task) => includesStatus(DASHBOARD_ACTIVE_STATUSES, task.status))
    .filter((task) => task.status === "NEED_CONFIRM" ? hasWaitingUserContext(task) : hasLiveContext(task))
    .sort(compareNewest);
  const waiting = canonicalTasks
    .filter((task) => includesStatus(DASHBOARD_WAITING_STATUSES, task.status))
    .filter(hasQueuedContext)
    .sort(compareNewest);
  const attention = canonicalTasks
    .filter((task) => includesStatus(DASHBOARD_ATTENTION_STATUSES, task.status))
    .sort(compareNewest);
  const history = canonicalTasks
    .filter((task) => includesStatus(DASHBOARD_TERMINAL_STATUSES, task.status))
    .sort(compareNewest);
  const recentCompleted = history.slice(0, 5);
  const pendingConfirmations = active
    .filter((task) => task.status === "NEED_CONFIRM")
    .sort(compareNewest);
  const currentCandidate = [...active, ...waiting, ...attention].sort(currentSort)[0] ?? recentCompleted[0] ?? null;
  const currentKind: DashboardCurrentKind = currentCandidate === null
    ? "idle"
    : includesStatus(DASHBOARD_ACTIVE_STATUSES, currentCandidate.status)
      ? "active"
      : includesStatus(DASHBOARD_WAITING_STATUSES, currentCandidate.status)
        ? "waiting"
        : includesStatus(DASHBOARD_ATTENTION_STATUSES, currentCandidate.status)
          ? "attention"
          : "recent_completed";

  return {
    current: currentCandidate,
    current_kind: currentKind,
    active,
    waiting,
    attention,
    recent_completed: recentCompleted,
    history,
    pending_confirmations: pendingConfirmations,
    counts,
    bridge_active_count: active.filter((task) => task.execution_source === "bridge").length,
    native_active_count: active.filter(
      (task) =>
        task.execution_source === "external/native" &&
        includesStatus(NATIVE_EXECUTION_STATUSES, task.status),
    ).length,
  };
}
