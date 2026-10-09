import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PortRegistry, resolveStatusUrlFile } from "../src/port-registry.js";

test("PortRegistry publishes only the current generation and rejects stale leases", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-port-registry-"));
  try {
    const file = join(directory, "run", "status-url.json");
    const current = new PortRegistry(file, "generation-current");
    const old = new PortRegistry(file, "generation-old");
    current.publishReady(37930);
    assert.equal(current.read()?.generation, "generation-current");
    assert.equal(current.read()?.url, "http://127.0.0.1:37930/api/status");
    assert.equal(old.read(), null);
    current.publishStopped();
    assert.equal(current.read()?.state, "stopped");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PortRegistry does not treat malformed or foreign state as a lease", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-port-registry-"));
  try {
    const file = join(directory, "status-url.json");
    const registry = new PortRegistry(file, "generation-current");
    writeFileSync(file, JSON.stringify({ generation: "other", state: "ready", host: "127.0.0.1", port: 37930, url: "http://127.0.0.1:37930/api/status", updated_at: new Date().toISOString() }), "utf8");
    assert.equal(registry.read(), null);
    writeFileSync(file, "not-json", "utf8");
    assert.equal(registry.read(), null);
    assert.equal(resolveStatusUrlFile({ LOCAL_CODEX_BRIDGE_STATUS_URL_FILE: file }), file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
