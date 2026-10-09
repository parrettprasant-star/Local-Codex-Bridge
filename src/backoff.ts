export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  jitterRatio?: number;
}

export function exponentialBackoffMs(
  retryCount: number,
  options: BackoffOptions = {},
  random: () => number = Math.random,
): number {
  const baseMs = options.baseMs ?? 250;
  const maxMs = options.maxMs ?? 10_000;
  const jitterRatio = options.jitterRatio ?? 0.25;
  if (!Number.isInteger(retryCount) || retryCount < 0) throw new Error("retryCount must be non-negative");
  const raw = Math.min(maxMs, baseMs * 2 ** retryCount);
  const jitter = raw * jitterRatio * Math.max(0, Math.min(1, random()));
  return Math.min(maxMs, Math.round(raw + jitter));
}
