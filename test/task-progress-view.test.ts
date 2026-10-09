import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskProgressView } from "../src/task-progress-view.js";

test("task progress view derives reading stage, category, steps, and next action", () => {
  const view = buildTaskProgressView({
    name: "示例内容生产任务",
    type: "内容生产",
    status: "RUNNING",
    stage: "running",
    progress: 60,
    current_action: "正在读取项目规则",
    next_action: "开始生成内容",
    completed_items: ["读取配置文件", "加载 Skill"],
  }, [
    { type: "task.started", stage: "planning", message: "任务已启动", progress: 0 },
    { type: "task.progressed", stage: "reading", message: "正在读取项目规则", progress: 60 },
  ]);

  assert.equal(view.phase, "reading");
  assert.equal(view.phase_label, "读取文件");
  assert.equal(view.category, "content-production");
  assert.equal(view.category_label, "内容生产");
  assert.equal(view.progress, 60);
  assert.equal(view.progress_known, true);
  assert.deepEqual(view.steps.map((step) => step.status), ["completed", "current", "pending", "pending", "pending"]);
  assert.equal(view.last_successful_step, "加载 Skill");
  assert.equal(view.next_action, "开始生成内容");
});

test("completed task progress view preserves completion time, summary, and output locations", () => {
  const view = buildTaskProgressView({
    name: "整理数据报表",
    type: "数据处理",
    status: "COMPLETED",
    progress: 95,
    completed_at: "2026-09-01T09:30:00.000Z",
    result_summary: "已整理 12 个数据文件",
    output_files: ["C:\\Reports\\summary.xlsx"],
    output_directories: ["C:\\Reports\\final"],
  });

  assert.equal(view.phase, "completed");
  assert.equal(view.phase_label, "已完成");
  assert.equal(view.category_label, "数据处理");
  assert.equal(view.progress, 100);
  assert.equal(view.completed_at, "2026-09-01T09:30:00.000Z");
  assert.equal(view.result_summary, "已整理 12 个数据文件");
  assert.deepEqual(view.output_locations, ["C:\\Reports\\summary.xlsx", "C:\\Reports\\final"]);
  assert.equal(view.steps.every((step) => step.status === "completed"), true);
  assert.equal(view.failure_reason, null);
});

test("failed task progress view retains failure phase, reason, and last success", () => {
  const view = buildTaskProgressView({
    name: "生成内容结果",
    type: "内容生产",
    status: "FAILED",
    progress: 60,
    stage: "generating",
    current_action: "生成文件失败",
    last_error: "输出目录不可用",
    completed_items: ["读取配置文件", "加载 Skill"],
  });

  assert.equal(view.phase, "failed");
  assert.equal(view.phase_label, "执行失败");
  assert.equal(view.failure_stage, "生成结果");
  assert.equal(view.failure_reason, "输出目录不可用");
  assert.equal(view.last_successful_step, "加载 Skill");
  assert.equal(view.steps[3]?.status, "failed");
});

test("unknown category and missing progress fail safe to neutral display", () => {
  const view = buildTaskProgressView({
    name: "未分类工作",
    status: "RUNNING",
    progress: "not-a-number",
  });

  assert.equal(view.category, "unclassified");
  assert.equal(view.category_label, "未分类");
  assert.equal(view.progress, null);
  assert.equal(view.progress_known, false);
});

test("recovery-required tasks clear stale progress and show a handling phase", () => {
  const view = buildTaskProgressView({
    name: "丢失的 AGENTS 任务",
    status: "RECOVERY_REQUIRED",
    stage: "reasoning",
    progress: 60,
    current_action: "正在分析",
    next_action: "结束任务或重新提交",
    last_error: "Ephemeral Bridge tasks are not resumable after process loss",
  });

  assert.equal(view.phase, "recovery");
  assert.equal(view.phase_label, "需要处理");
  assert.equal(view.progress, null);
  assert.equal(view.progress_known, false);
  assert.equal(view.last_successful_step, null);
  assert.equal(view.failure_reason, null);
});
