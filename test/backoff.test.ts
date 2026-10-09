import assert from "node:assert/strict";
import test from "node:test";

import { exponentialBackoffMs } from "../src/backoff.js";

test("backoff is exponential, jittered, and bounded", () => {
  assert.equal(exponentialBackoffMs(0, { baseMs: 100, maxMs: 1_000, jitterRatio: 0 }, () => 0), 100);
  assert.equal(exponentialBackoffMs(1, { baseMs: 100, maxMs: 1_000, jitterRatio: 0 }, () => 0), 200);
  assert.equal(exponentialBackoffMs(20, { baseMs: 100, maxMs: 1_000, jitterRatio: 1 }, () => 1), 1_000);
  const jittered = exponentialBackoffMs(2, { baseMs: 100, maxMs: 1_000, jitterRatio: 0.25 }, () => 1);
  assert.equal(jittered, 500);
});
