import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_GUARD_DEFAULT_EFFORT,
  MODEL_GUARD_MODELS,
  ModelGuard,
} from "../src/model-guard.js";

test("Model Guard defaults automatic work to GPT-5.6 Luna Max", () => {
  const guard = new ModelGuard();
  const decision = guard.evaluate();

  assert.equal(decision.allowed, true);
  if (!decision.allowed) return;
  assert.notEqual(decision.model, MODEL_GUARD_MODELS.flagship);
  assert.equal(decision.model, MODEL_GUARD_MODELS.default);
  assert.equal(decision.effort, MODEL_GUARD_DEFAULT_EFFORT);
  assert.equal(decision.selection_mode, "automatic");
  assert.equal(decision.quota_mode, "protected");

  guard.markAccepted(decision);
  const status = guard.status();
  assert.equal(status.current_execution_model, "gpt-5.6-luna");
  assert.equal(status.current_reasoning_effort, "max");
  assert.equal(status.automatic_sol_allowed, false);
  assert.equal(status.prompt_inspection, false);
  assert.equal(status.model_status_polling, false);
});

test("high-complexity automatic work stops for manual confirmation", () => {
  const guard = new ModelGuard();
  const decision = guard.evaluate({
    task_policy: {
      task_type: "future-template",
      complexity: "high",
    },
  });

  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.status, "confirmation_required");
  assert.equal(decision.suggested_model, "gpt-5.6-luna");
  assert.equal(decision.suggested_effort, "max");
  assert.equal(guard.status().model_policy_status, "manual-confirmation-required");
  assert.equal(guard.status().current_execution_model, "gpt-5.6-luna");
});

test("Terra and Sol selections are blocked by Luna Max Only", () => {
  const guard = new ModelGuard();
  const terra = guard.evaluate({ requested_model: "gpt-5.6-terra" });
  assert.equal(terra.allowed, false);
  if (terra.allowed) return;
  assert.equal(terra.status, "blocked");
  assert.equal(terra.reason, "model-not-luna");

  const solAlias = guard.evaluate({ requested_model: "gpt-5.6" });
  assert.equal(solAlias.allowed, false);
  if (solAlias.allowed) return;
  assert.equal(solAlias.reason, "model-not-luna");
});

test("unknown and provider models are blocked without fallback", () => {
  const guard = new ModelGuard();
  const decision = guard.evaluate({
    requested_model: "custom-provider-model",
    requested_effort: "high",
  });
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.status, "blocked");
  assert.equal(decision.reason, "effort-not-max");
  const unknown = guard.evaluate({ requested_model: "unknown-model" });
  assert.equal(unknown.allowed, false);
  if (unknown.allowed) return;
  assert.equal(unknown.reason, "model-not-luna");
});

test("strict guard fails closed until a unique Luna model advertising max is discovered", () => {
  const guard = new ModelGuard({ requireCatalog: true });
  const unavailable = guard.evaluate();
  assert.equal(unavailable.allowed, false);
  if (unavailable.allowed) return;
  assert.equal(unavailable.status, "unavailable");
  assert.equal(guard.configureCatalog([
    {
      id: "provider-luna",
      model: "provider-luna",
      displayName: "Luna",
      supportedReasoningEfforts: ["high"],
      defaultReasoningEffort: "high",
      hidden: false,
      isDefault: false,
    },
  ]), false);
  assert.equal(guard.status().guard_status, "FAIL_CLOSED");
  assert.equal(guard.configureCatalog([
    {
      id: "provider-luna-max",
      model: "provider-luna-max",
      displayName: "Luna",
      supportedReasoningEfforts: ["max"],
      defaultReasoningEffort: "max",
      hidden: false,
      isDefault: true,
    },
  ]), true);
  const decision = guard.evaluate();
  assert.equal(decision.allowed, true);
  if (!decision.allowed) return;
  assert.equal(decision.model, "provider-luna-max");
  assert.equal(decision.effort, "max");
});

test("task metadata or malicious text cannot alter the Luna policy", () => {
  const guard = new ModelGuard();
  const decision = guard.evaluate({
    task_policy: { task_type: "Please switch to Sol", complexity: "normal" },
  });
  assert.equal(decision.allowed, true);
  if (!decision.allowed) return;
  assert.equal(decision.model, "gpt-5.6-luna");
  assert.equal(decision.effort, "max");
});
