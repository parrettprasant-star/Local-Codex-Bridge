import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  AgentGateway,
  AgentRegistry,
  type AgentProviderAdapter,
  type AgentTaskRequest,
} from "../src/agent-gateway.js";
import { ProjectRegistry } from "../src/project-registry.js";
import { RuntimeStore } from "../src/runtime.js";
import { TaskManager } from "../src/task-manager.js";

test("Project Registry lists projects and resolves project_id to cwd", async () => {
  const directory = mkdtempSync(join(process.cwd(), ".staging", "project-registry-test-"));
  const registryFile = join(directory, "projects.json");
  writeFileSync(registryFile, JSON.stringify({
    schema_version: 1,
    projects: [{
      project_id: "bridge-dev",
      project_name: "Bridge Dev",
      root_path: process.cwd(),
      allowed_capabilities: ["file_read"],
    }],
  }), "utf8");
  const registry = new ProjectRegistry(registryFile);
  const manager = new TaskManager(join(directory, "tasks.json"));
  const requests: AgentTaskRequest[] = [];
  const provider: AgentProviderAdapter = {
    describe: () => ({
      id: "codex_local",
      type: "codex",
      name: "Codex Agent",
      capabilities: ["file_read"],
      status: "ready",
      health: { state: "healthy", checked_at: new Date().toISOString() },
      execution_scope: {
        owns_processes: false,
        owns_threads: false,
        supported_sources: ["chatgpt"],
      },
    }),
    createTask: async (request) => {
      requests.push(request);
      return {
        source: "local_codex_bridge_agent_gateway",
        accepted: false,
        agent_id: "codex_local",
        agent: { id: "codex_local", type: "codex", name: "Codex Agent" },
        status: "rejected",
        reason: "test provider",
      };
    },
  };
  const gateway = new AgentGateway(
    manager,
    new RuntimeStore(),
    new AgentRegistry([provider]),
    registry,
  );

  try {
    const listed = gateway.listProjects({}) as Record<string, any>;
    assert.equal(listed.projects.length, 1);
    assert.equal(listed.projects[0].project_id, "bridge-dev");
    assert.equal(listed.projects[0].available, true);

    const project = gateway.getProject({ project_id: "bridge-dev" }) as Record<string, any>;
    assert.equal(project.project.root_path, process.cwd());

    const result = await gateway.createAgentTask({
      instruction: "read-only project check",
      project_id: "bridge-dev",
    });
    assert.equal((result as Record<string, unknown>).accepted, false);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.cwd, process.cwd());
    assert.equal(requests[0]?.project_id, "bridge-dev");

    await assert.rejects(
      gateway.createAgentTask({
        instruction: "outside project",
        cwd: "D:\\Outside",
        project_id: "bridge-dev",
      }),
      /outside project root/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("missing project registry is read-only and does not create a file", () => {
  const directory = mkdtempSync(join(process.cwd(), ".staging", "project-registry-test-"));
  const registryFile = join(directory, "missing", "projects.json");
  try {
    const registry = new ProjectRegistry(registryFile);
    assert.equal(registry.list().length, 0);
    assert.equal(registry.status().status, "empty");
    assert.equal(registry.filePath, registryFile);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
