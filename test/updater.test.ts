import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LocalManifestUpdater,
  resolveLocalUpdateManifestFile,
} from "../src/updater.js";

test("local-dev updater reads Bridge Codex metadata without auto-apply", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-codex-bridge-v6-updater-"));
  try {
    const path = join(directory, "update-manifest.local.json");
    writeFileSync(path, JSON.stringify({
      schema_version: 1,
      product: "Bridge Codex",
      version: "6.0.0-dev",
      channel: "local-dev",
      build: "test-build",
    }));
    const updater = new LocalManifestUpdater(path);
    const snapshot = updater.snapshot();
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.manifest?.product, "Bridge Codex");
    assert.equal(snapshot.auto_apply, false);
    assert.equal(resolveLocalUpdateManifestFile({ LOCAL_CODEX_BRIDGE_UPDATE_MANIFEST: path }), path);

    writeFileSync(path, JSON.stringify({ schema_version: 1, product: "Local Codex Bridge", version: "old", channel: "local-dev" }));
    const invalid = updater.snapshot();
    assert.equal(invalid.available, false);
    assert.match(invalid.error ?? "", /product/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
