export type TaskProgressPhase =
  | "pending"
  | "planning"
  | "reading"
  | "executing"
  | "generating"
  | "finalizing"
  | "waiting"
  | "recovery"
  | "completed"
  | "failed"
  | "interrupted";

export type TaskCategory =
  | "content-production"
  | "asset-search"
  | "system-maintenance"
  | "data-processing"
  | "other"
  | "unclassified";

export type TaskProgressStepStatus = "completed" | "current" | "pending" | "failed";

export interface TaskProgressTaskInput {
  status?: unknown;
  stage?: unknown;
  current_action?: unknown;
  next_action?: unknown;
  progress?: unknown;
  name?: unknown;
  type?: unknown;
  task_type?: unknown;
  category?: unknown;
  task_category?: unknown;
  skill?: unknown;
  account?: unknown;
  completed_items?: unknown;
  output_files?: unknown;
  output_directories?: unknown;
  result_summary?: unknown;
  final_answer?: unknown;
  completed_at?: unknown;
  last_error?: unknown;
}

export interface TaskProgressEventInput {
  task_id?: unknown;
  type?: unknown;
  stage?: unknown;
  message?: unknown;
  current_action?: unknown;
  progress?: unknown;
  status?: unknown;
}

export interface TaskProgressStep {
  id: Exclude<TaskProgressPhase, "pending" | "waiting" | "completed" | "failed" | "interrupted">;
  label: string;
  status: TaskProgressStepStatus;
}

export interface TaskProgressView {
  phase: TaskProgressPhase;
  phase_label: string;
  category: TaskCategory;
  category_label: string;
  progress: number | null;
  progress_known: boolean;
  current_action: string | null;
  next_action: string | null;
  completed_at: string | null;
  result_summary: string | null;
  output_locations: string[];
  failure_stage: string | null;
  failure_reason: string | null;
  last_successful_step: string | null;
  steps: TaskProgressStep[];
}

const STEP_DEFINITIONS = [
  { id: "planning", label: "分析任务" },
  { id: "reading", label: "读取文件" },
  { id: "executing", label: "执行中" },
  { id: "generating", label: "生成结果" },
  { id: "finalizing", label: "整理输出" },
] as const;

const PHASE_LABELS: Record<TaskProgressPhase, string> = {
  pending: "等待执行",
  planning: "分析任务",
  reading: "读取文件",
  executing: "执行中",
  generating: "生成结果",
  finalizing: "整理输出",
  waiting: "等待确认",
  recovery: "需要处理",
  completed: "已完成",
  failed: "执行失败",
  interrupted: "已中断",
};

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  "content-production": "内容生产",
  "asset-search": "素材搜索",
  "system-maintenance": "系统维护",
  "data-processing": "数据处理",
  other: "其他",
  unclassified: "未分类",
};

type StepPhase = (typeof STEP_DEFINITIONS)[number]["id"];

function stringValue(value: unknown, maximum = 4_000): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length <= maximum ? text : text.slice(0, maximum - 1) + "…";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function statusValue(value: unknown): string {
  return (stringValue(value, 100) ?? "").toLowerCase();
}

function firstString(values: readonly unknown[], maximum = 4_000): string | null {
  for (const value of values) {
    const text = stringValue(value, maximum);
    if (text) return text;
  }
  return null;
}

function arrayStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => stringValue(item, 1_000))
    .filter((item): item is string => item !== null);
}

function phaseFromText(value: unknown): TaskProgressPhase | null {
  const text = stringValue(value, 500)?.toLowerCase();
  if (!text) return null;
  if (/confirm|approval|审批|确认|用户输入/u.test(text)) return "waiting";
  if (/complete|completed|done|finaliz|final answer|整理|已完成/u.test(text)) return "finalizing";
  if (/generat|compose|write|content|result|生成|写入|产出/u.test(text)) return "generating";
  if (/command|exec|tool|run|execute|执行|命令|调用/u.test(text)) return "executing";
  if (/read|load|scan|inspect|analy|search|读取|加载|扫描|分析|搜索|查找/u.test(text)) return "reading";
  if (/queue|queued|pending|plan|start|prepare|bootstrap|创建|排队|准备|规划|启动|建立/u.test(text)) return "planning";
  if (/wait|waiting|等待/u.test(text)) return "pending";
  return null;
}

function stepPhase(value: TaskProgressPhase | null): StepPhase | null {
  return value && STEP_DEFINITIONS.some((step) => step.id === value)
    ? value as StepPhase
    : null;
}

function terminalStatus(status: string): "completed" | "failed" | "interrupted" | null {
  if (["done", "completed", "success", "succeeded"].includes(status)) return "completed";
  if (["failed", "error", "fatal"].includes(status)) return "failed";
  if (["interrupted", "cancelled", "canceled"].includes(status)) return "interrupted";
  return null;
}

function inferCategory(task: TaskProgressTaskInput): TaskCategory {
  const explicit = firstString([task.category, task.task_category], 100)?.toLowerCase();
  if (explicit) {
    if (/content|内容|文案|生产/u.test(explicit)) return "content-production";
    if (/asset|素材|图片|视频/u.test(explicit)) return "asset-search";
    if (/maintenance|system|维护|系统/u.test(explicit)) return "system-maintenance";
    if (/data|数据|处理/u.test(explicit)) return "data-processing";
    if (/other|其他/u.test(explicit)) return "other";
  }
  const hints = [task.name, task.type, task.task_type, task.skill, task.account]
    .map((value) => stringValue(value, 200)?.toLowerCase() ?? "")
    .join(" ");
  if (/小红书|文案|内容|content|copy|生产|发布|文章/u.test(hints)) return "content-production";
  if (/素材|图片|视频|asset|photo|media|选图/u.test(hints)) return "asset-search";
  if (/系统|维护|修复|诊断|部署|build|test|tunnel|plugin|lifecycle/u.test(hints)) return "system-maintenance";
  if (/数据|表格|excel|csv|数据库|清洗|转换|统计/u.test(hints)) return "data-processing";
  return "unclassified";
}

function inferActivePhase(
  task: TaskProgressTaskInput,
  events: readonly TaskProgressEventInput[],
): TaskProgressPhase {
  const status = statusValue(task.status);
  const terminal = terminalStatus(status);
  if (terminal) return terminal;
  if (status === "recovery_required") return "recovery";
  if (["need_confirm", "needconfirmation"].includes(status)) return "waiting";
  if (["waiting", "queued", "pending", "blocked"].includes(status)) return "pending";

  const direct = phaseFromText(task.current_action);
  if (direct) return direct;
  const stage = phaseFromText(task.stage);
  if (stage) return stage;
  for (const event of [...events].reverse()) {
    const eventPhase = phaseFromText(firstString([
      event.message,
      event.current_action,
      event.stage,
      event.type,
    ], 500));
    if (eventPhase && eventPhase !== "pending") return eventPhase;
  }
  if (["waiting", "queued"].includes(status)) return "pending";
  if (["starting", "created"].includes(status)) return "planning";
  if (["running", "retrying"].includes(status)) return "executing";
  return "planning";
}

function eventStepPhases(events: readonly TaskProgressEventInput[]): StepPhase[] {
  return events
    .map((event) => stepPhase(phaseFromText(firstString([
      event.message,
      event.current_action,
      event.stage,
      event.type,
    ], 500))))
    .filter((phase): phase is StepPhase => phase !== null);
}

function inferWorkStepPhase(
  task: TaskProgressTaskInput,
  events: readonly TaskProgressEventInput[],
): StepPhase | null {
  const direct = stepPhase(phaseFromText(task.current_action));
  if (direct) return direct;
  const stage = stepPhase(phaseFromText(task.stage));
  if (stage) return stage;
  return eventStepPhases(events).at(-1) ?? null;
}

function buildSteps(
  phase: TaskProgressPhase,
  events: readonly TaskProgressEventInput[],
  workPhase: StepPhase | null,
): { steps: TaskProgressStep[]; currentStep: StepPhase | null } {
  const terminal = phase === "completed";
  const failed = phase === "failed" || phase === "interrupted";
  const eventPhases = eventStepPhases(events);
  const inferred = stepPhase(phase) ?? workPhase ?? eventPhases.at(-1) ?? null;
  const currentIndex = inferred === null ? -1 : STEP_DEFINITIONS.findIndex((step) => step.id === inferred);
  const steps = STEP_DEFINITIONS.map((step, index) => {
    let status: TaskProgressStepStatus = "pending";
    if (terminal) status = "completed";
    else if (failed && index === currentIndex) status = "failed";
    else if (index < currentIndex) status = "completed";
    else if (index === currentIndex) status = "current";
    return { id: step.id, label: step.label, status };
  });
  return { steps, currentStep: inferred };
}

export function buildTaskProgressView(
  task: TaskProgressTaskInput,
  events: readonly TaskProgressEventInput[] = [],
): TaskProgressView {
  const status = statusValue(task.status);
  const phase = inferActivePhase(task, events);
  const { steps, currentStep } = buildSteps(phase, events, inferWorkStepPhase(task, events));
  const rawProgress = numberValue(task.progress);
  const progress = phase === "recovery"
    ? null
    : phase === "completed"
    ? 100
    : rawProgress !== null && rawProgress >= 0 && rawProgress <= 100
      ? rawProgress
      : null;
  const completedItems = arrayStrings(task.completed_items);
  const terminal = terminalStatus(status);
  const resultSummary = firstString([task.result_summary, task.final_answer]);
  const outputLocations = [...new Set([
    ...arrayStrings(task.output_files),
    ...arrayStrings(task.output_directories),
  ])];
  const failureReason = terminal === "failed"
    ? firstString([task.last_error, ...[...events].reverse().map((event) => event.message)])
    : null;
  const lastSuccessfulStep = phase === "recovery"
    ? null
    : completedItems.at(-1)
    ?? (terminal === "completed"
      ? STEP_DEFINITIONS.at(-1)?.label ?? null
      : currentStep
        ? STEP_DEFINITIONS[Math.max(0, STEP_DEFINITIONS.findIndex((step) => step.id === currentStep) - 1)]?.label ?? null
        : null);
  const currentAction = firstString([task.current_action, phase === "completed" ? "任务完成" : PHASE_LABELS[phase]]);
  const nextAction = firstString([task.next_action]);
  return {
    phase,
    phase_label: PHASE_LABELS[phase],
    category: inferCategory(task),
    category_label: CATEGORY_LABELS[inferCategory(task)],
    progress,
    progress_known: progress !== null,
    current_action: currentAction,
    next_action: nextAction,
    completed_at: stringValue(task.completed_at, 100),
    result_summary: resultSummary,
    output_locations: outputLocations,
    failure_stage: terminal === "failed" || terminal === "interrupted" || phase === "recovery"
      ? (currentStep ? PHASE_LABELS[currentStep] : PHASE_LABELS[phase])
      : null,
    failure_reason: failureReason,
    last_successful_step: lastSuccessfulStep,
    steps,
  };
}
