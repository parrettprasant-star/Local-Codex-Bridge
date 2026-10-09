import assert from "node:assert/strict";
import test from "node:test";

import { StartupSupervisor } from "../src/startup-supervisor.js";

test("accelerated lifecycle soak never reuses a generation or leaves READY after failure", () => {
  const generations = new Set<string>();
  for (let index = 0; index < 50; index += 1) {
    const supervisor = new StartupSupervisor();
    assert.equal(generations.has(supervisor.generation), false);
    generations.add(supervisor.generation);
    supervisor.transition("HOST_READY", "host ready");
    supervisor.transition("UI_READY", "ui ready");
    supervisor.transition("DEGRADED", "injected failure");
    assert.notEqual(supervisor.phase(), "READY");
    supervisor.transition("STOPPED", "shutdown");
    assert.equal(supervisor.phase(), "STOPPED");
  }
  assert.equal(generations.size, 50);
});
