import path from "node:path";
import { canonicalizeLocalPath, isWithinLocalRoot } from "./local-path.js";

const WINDOWS_PATH_LIMIT = 1_000;

export interface WriteClaim {
  claim_id: string;
  task_id: string;
  roots: string[];
  acquired_at: string;
}

export interface WriteClaimConflict {
  task_id: string;
  claim_id: string;
  requested_root: string;
  claimed_root: string;
}

export class WriteClaimConflictError extends Error {
  readonly conflict: WriteClaimConflict;

  constructor(conflict: WriteClaimConflict) {
    super(
      `write claim conflicts with task ${conflict.task_id}: ${conflict.requested_root} overlaps ${conflict.claimed_root}`,
    );
    this.name = "WriteClaimConflictError";
    this.conflict = conflict;
  }
}

function validateWindowsPath(value: string): string {
  if (
    value.length === 0 ||
    value.length > WINDOWS_PATH_LIMIT ||
    value.includes(String.fromCharCode(0)) ||
    value.includes(String.fromCharCode(13)) ||
    value.includes(String.fromCharCode(10))
  ) {
    throw new Error("write root must be a bounded Windows path without control characters");
  }
  if (!/^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error("write root must be an absolute Windows drive-letter path");
  }
  return value;
}

/**
 * Canonicalize a Windows path without touching the filesystem. Windows paths
 * are case-insensitive for claim purposes, so the normalized representation
 * uses an upper-case drive and lower-case remaining components.
 */
export function canonicalizeWindowsPath(value: string): string {
  const checked = validateWindowsPath(value);
  const normalized = path.win32.normalize(checked.replaceAll("/", "\\"));
  const drive = normalized.slice(0, 2).toUpperCase();
  let rest = normalized.slice(2).replaceAll("/", "\\");
  if (!rest.startsWith("\\")) {
    rest = "\\" + rest;
  }
  if (rest.length > 1) {
    rest = rest.replace(/[\\]+$/, "");
  }
  return (drive + rest).toLowerCase();
}

export function pathsOverlap(left: string, right: string): boolean {
  return isWithinLocalRoot(left, right) || isWithinLocalRoot(right, left);
}

export function normalizeWriteRoots(roots: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const root of roots) {
    unique.add(canonicalizeLocalPath(root));
  }
  return [...unique].sort();
}

export class WriteClaimRegistry {
  readonly #claims = new Map<string, WriteClaim>();
  readonly #clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.#clock = clock;
  }

  claim(taskId: string, roots: readonly string[], claimId = taskId): WriteClaim {
    const normalizedRoots = normalizeWriteRoots(roots);
    for (const existing of this.#claims.values()) {
      if (existing.task_id === taskId) {
        continue;
      }
      for (const requestedRoot of normalizedRoots) {
        const claimedRoot = existing.roots.find((root) => pathsOverlap(root, requestedRoot));
        if (claimedRoot) {
          throw new WriteClaimConflictError({
            task_id: existing.task_id,
            claim_id: existing.claim_id,
            requested_root: requestedRoot,
            claimed_root: claimedRoot,
          });
        }
      }
    }
    const claim: WriteClaim = {
      claim_id: claimId,
      task_id: taskId,
      roots: normalizedRoots,
      acquired_at: this.#clock().toISOString(),
    };
    this.#claims.set(claimId, claim);
    return cloneClaim(claim);
  }

  release(claimId: string): boolean {
    return this.#claims.delete(claimId);
  }

  releaseForTask(taskId: string): number {
    let released = 0;
    for (const [claimId, claim] of this.#claims) {
      if (claim.task_id === taskId) {
        this.#claims.delete(claimId);
        released += 1;
      }
    }
    return released;
  }

  hasConflict(taskId: string, roots: readonly string[]): WriteClaimConflict | null {
    const normalizedRoots = normalizeWriteRoots(roots);
    for (const existing of this.#claims.values()) {
      if (existing.task_id === taskId) {
        continue;
      }
      for (const requestedRoot of normalizedRoots) {
        const claimedRoot = existing.roots.find((root) => pathsOverlap(root, requestedRoot));
        if (claimedRoot) {
          return {
            task_id: existing.task_id,
            claim_id: existing.claim_id,
            requested_root: requestedRoot,
            claimed_root: claimedRoot,
          };
        }
      }
    }
    return null;
  }

  snapshot(): WriteClaim[] {
    return [...this.#claims.values()].map(cloneClaim);
  }
}

function cloneClaim(claim: WriteClaim): WriteClaim {
  return { ...claim, roots: [...claim.roots] };
}
