import type { AppServerModel } from "./app-server-adapter.js";

export const MODEL_GUARD_MODELS = {
  default: "gpt-5.6-luna",
  manualUpgrade: "gpt-5.6-terra",
  flagship: "gpt-5.6-sol",
} as const;

export const MODEL_GUARD_DEFAULT_EFFORT = "max" as const;

export type TaskComplexity = "normal" | "high";
export type ModelSelectionMode = "automatic" | "manual";
export type ModelQuotaMode = "protected" | "unavailable";
export type ModelPolicyStatus =
  | "active"
  | "manual-confirmation-required"
  | "blocked"
  | "unavailable";
export type ModelGuardStatusCode = "READY" | "BLOCKED" | "WAITING" | "FAIL_CLOSED";

export interface TaskTypeModelPolicy {
  task_type?: string;
  complexity?: TaskComplexity;
}

export interface ModelGuardRequest {
  requested_model?: string;
  requested_effort?: string;
  task_policy?: TaskTypeModelPolicy;
}

export interface AllowedModelDecision {
  allowed: true;
  model: string;
  effort: typeof MODEL_GUARD_DEFAULT_EFFORT;
  selection_mode: ModelSelectionMode;
  quota_mode: "protected";
  policy_status: "active";
  task_type: string;
  task_complexity: TaskComplexity;
  reason: "default-policy" | "explicit-luna-selection";
}

export interface ConfirmationRequiredModelDecision {
  allowed: false;
  status: "confirmation_required";
  policy_status: "manual-confirmation-required";
  task_type: string;
  task_complexity: "high";
  reason: "high-complexity-requires-manual-model-confirmation";
  suggested_model: string | null;
  suggested_effort: typeof MODEL_GUARD_DEFAULT_EFFORT;
}

export interface BlockedModelDecision {
  allowed: false;
  status: "blocked" | "unavailable";
  policy_status: "blocked" | "unavailable";
  task_type: string;
  task_complexity: TaskComplexity;
  reason:
    | "luna-model-unavailable"
    | "model-not-luna"
    | "effort-not-max"
    | "catalog-ambiguous";
  requested_model: string | null;
  requested_effort: string | null;
}

export type ModelGuardDecision =
  | AllowedModelDecision
  | ConfirmationRequiredModelDecision
  | BlockedModelDecision;

export interface ModelGuardStatus {
  schema_version: 2;
  policy_model: string | null;
  policy_effort: typeof MODEL_GUARD_DEFAULT_EFFORT;
  requested_model: string | null;
  requested_effort: string | null;
  observed_model: string | null;
  observed_effort: string | null;
  guard_status: ModelGuardStatusCode;
  catalog_state: "uninitialized" | "ready" | "unavailable" | "ambiguous";
  current_execution_model: string | null;
  current_reasoning_effort: string | null;
  quota_mode: ModelQuotaMode;
  model_policy_status: ModelPolicyStatus;
  selection_mode: ModelSelectionMode;
  task_type: string;
  task_complexity: TaskComplexity;
  default_model: typeof MODEL_GUARD_MODELS.default;
  default_effort: typeof MODEL_GUARD_DEFAULT_EFFORT;
  manual_upgrade_model: typeof MODEL_GUARD_MODELS.manualUpgrade;
  automatic_sol_allowed: false;
  provider_fallback_allowed: false;
  high_complexity_requires_confirmation: true;
  prompt_inspection: false;
  model_status_polling: false;
}

const MAX_TASK_TYPE_CHARS = 100;
const MAX_MODEL_CHARS = 200;
const MAX_EFFORT_CHARS = 32;

function optionalBoundedText(value: string | undefined, field: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new Error(`${field} must contain 1 to ${maximum} characters`);
  }
  return normalized;
}

function modelSearchText(model: AppServerModel): string {
  return `${model.id} ${model.model} ${model.displayName}`.toLowerCase();
}

export interface ModelGuardOptions {
  requireCatalog?: boolean;
}

export class ModelGuard {
  readonly #requireCatalog: boolean;
  #catalogReady = false;
  #policyModel: AppServerModel | null = null;
  #catalogState: ModelGuardStatus["catalog_state"] = "uninitialized";
  #status: ModelGuardStatus = {
    schema_version: 2,
    policy_model: null,
    policy_effort: MODEL_GUARD_DEFAULT_EFFORT,
    requested_model: null,
    requested_effort: null,
    observed_model: null,
    observed_effort: null,
    guard_status: "WAITING",
    catalog_state: "uninitialized",
    current_execution_model: null,
    current_reasoning_effort: null,
    quota_mode: "unavailable",
    model_policy_status: "unavailable",
    selection_mode: "automatic",
    task_type: "general",
    task_complexity: "normal",
    default_model: MODEL_GUARD_MODELS.default,
    default_effort: MODEL_GUARD_DEFAULT_EFFORT,
    manual_upgrade_model: MODEL_GUARD_MODELS.manualUpgrade,
    automatic_sol_allowed: false,
    provider_fallback_allowed: false,
    high_complexity_requires_confirmation: true,
    prompt_inspection: false,
    model_status_polling: false,
  };

  constructor(options: ModelGuardOptions = {}) {
    this.#requireCatalog = options.requireCatalog ?? false;
    if (!this.#requireCatalog) {
      this.#catalogReady = true;
      this.#catalogState = "ready";
      this.#policyModel = {
        id: MODEL_GUARD_MODELS.default,
        model: MODEL_GUARD_MODELS.default,
        displayName: "GPT-5.6 Luna",
        supportedReasoningEfforts: [MODEL_GUARD_DEFAULT_EFFORT],
        defaultReasoningEffort: MODEL_GUARD_DEFAULT_EFFORT,
        hidden: false,
        isDefault: true,
      };
      this.#status = {
        ...this.#status,
        policy_model: MODEL_GUARD_MODELS.default,
        catalog_state: "ready",
        guard_status: "READY",
        model_policy_status: "active",
        quota_mode: "protected",
        current_execution_model: MODEL_GUARD_MODELS.default,
        current_reasoning_effort: MODEL_GUARD_DEFAULT_EFFORT,
      };
    }
  }

  configureCatalog(models: readonly AppServerModel[]): boolean {
    const luna = models.filter((model) => /\bluna\b/i.test(modelSearchText(model)));
    const supported = luna.filter((model) =>
      model.supportedReasoningEfforts.includes(MODEL_GUARD_DEFAULT_EFFORT),
    );
    if (supported.length !== 1) {
      this.#catalogReady = false;
      this.#policyModel = null;
      this.#catalogState = supported.length === 0 ? "unavailable" : "ambiguous";
      this.#status = {
        ...this.#status,
        policy_model: null,
        catalog_state: this.#catalogState,
        guard_status: "FAIL_CLOSED",
        model_policy_status: "unavailable",
        quota_mode: "unavailable",
        current_execution_model: null,
        current_reasoning_effort: null,
      };
      return false;
    }
    this.#catalogReady = true;
    this.#policyModel = supported[0]!;
    this.#catalogState = "ready";
    this.#status = {
      ...this.#status,
      policy_model: this.#policyModel.id,
      catalog_state: "ready",
      guard_status: "READY",
      model_policy_status: "active",
      quota_mode: "protected",
      current_execution_model: this.#policyModel.id,
      current_reasoning_effort: MODEL_GUARD_DEFAULT_EFFORT,
    };
    return true;
  }

  policyModel(): string | null {
    return this.#policyModel?.id ?? null;
  }

  isReady(): boolean {
    return this.#catalogReady && this.#policyModel !== null;
  }

  evaluate(request: ModelGuardRequest = {}): ModelGuardDecision {
    const requestedModel = optionalBoundedText(request.requested_model, "requested_model", MAX_MODEL_CHARS);
    const requestedEffort = optionalBoundedText(request.requested_effort, "requested_effort", MAX_EFFORT_CHARS);
    const taskType = optionalBoundedText(request.task_policy?.task_type, "task_type", MAX_TASK_TYPE_CHARS) ?? "general";
    const complexity = request.task_policy?.complexity ?? "normal";
    if (complexity !== "normal" && complexity !== "high") {
      throw new Error("task complexity must be normal or high");
    }

    this.#status = {
      ...this.#status,
      requested_model: requestedModel ?? null,
      requested_effort: requestedEffort ?? null,
      task_type: taskType,
      task_complexity: complexity,
    };

    if (this.#requireCatalog && !this.isReady()) {
      return {
        allowed: false,
        status: "unavailable",
        policy_status: "unavailable",
        task_type: taskType,
        task_complexity: complexity,
        reason: this.#catalogState === "ambiguous" ? "catalog-ambiguous" : "luna-model-unavailable",
        requested_model: requestedModel ?? null,
        requested_effort: requestedEffort ?? null,
      };
    }

    if (requestedModel === undefined && complexity === "high") {
      this.#status = { ...this.#status, model_policy_status: "manual-confirmation-required" };
      return {
        allowed: false,
        status: "confirmation_required",
        policy_status: "manual-confirmation-required",
        task_type: taskType,
        task_complexity: "high",
        reason: "high-complexity-requires-manual-model-confirmation",
        suggested_model: this.#policyModel?.id ?? MODEL_GUARD_MODELS.default,
        suggested_effort: MODEL_GUARD_DEFAULT_EFFORT,
      };
    }

    if (requestedEffort !== undefined && requestedEffort !== MODEL_GUARD_DEFAULT_EFFORT) {
      this.#status = { ...this.#status, guard_status: "BLOCKED", model_policy_status: "blocked" };
      return {
        allowed: false,
        status: "blocked",
        policy_status: "blocked",
        task_type: taskType,
        task_complexity: complexity,
        reason: "effort-not-max",
        requested_model: requestedModel ?? null,
        requested_effort: requestedEffort,
      };
    }

    const policyModel = this.#policyModel?.id ?? MODEL_GUARD_MODELS.default;
    const acceptedIds = new Set([policyModel, this.#policyModel?.model ?? policyModel]);
    if (requestedModel !== undefined && !acceptedIds.has(requestedModel)) {
      this.#status = { ...this.#status, guard_status: "BLOCKED", model_policy_status: "blocked" };
      return {
        allowed: false,
        status: "blocked",
        policy_status: "blocked",
        task_type: taskType,
        task_complexity: complexity,
        reason: "model-not-luna",
        requested_model: requestedModel,
        requested_effort: requestedEffort ?? null,
      };
    }

    return {
      allowed: true,
      model: policyModel,
      effort: MODEL_GUARD_DEFAULT_EFFORT,
      selection_mode: requestedModel === undefined ? "automatic" : "manual",
      quota_mode: "protected",
      policy_status: "active",
      task_type: taskType,
      task_complexity: complexity,
      reason: requestedModel === undefined ? "default-policy" : "explicit-luna-selection",
    };
  }

  markAccepted(decision: AllowedModelDecision, observed?: { model?: string | null; effort?: string | null }): void {
    const observedModel = observed === undefined ? decision.model : observed.model ?? null;
    const observedEffort = observed === undefined ? decision.effort : observed.effort ?? null;
    const observedOkay = observedModel === decision.model && observedEffort === decision.effort;
    this.#status = {
      ...this.#status,
      policy_model: decision.model,
      requested_model: decision.selection_mode === "manual" ? decision.model : null,
      requested_effort: decision.effort,
      observed_model: observedModel,
      observed_effort: observedEffort,
      current_execution_model: observedModel,
      current_reasoning_effort: observedEffort,
      quota_mode: "protected",
      model_policy_status: observedOkay ? "active" : "blocked",
      guard_status: observedOkay ? "READY" : "FAIL_CLOSED",
      selection_mode: decision.selection_mode,
      task_type: decision.task_type,
      task_complexity: decision.task_complexity,
    };
  }

  status(): ModelGuardStatus {
    return { ...this.#status };
  }
}
