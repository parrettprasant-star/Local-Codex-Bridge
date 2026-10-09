import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readBuildIdentity(root = process.cwd()): { label: string; version: string } {
  const fallback = { label: "Local Codex Bridge development", version: "unversioned" };
  try {
    const metadata: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8").replace(/^\uFEFF/, ""));
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return fallback;
    const value = metadata as Record<string, unknown>;
    const version = typeof value.version === "string" && /^[a-zA-Z0-9.+-]{1,64}$/.test(value.version) ? value.version : fallback.version;
    const label = typeof value.build_label === "string" && /^[a-zA-Z0-9.-]{1,64}$/.test(value.build_label)
      ? value.build_label : `Local Codex Bridge ${version} development`;
    return { label, version };
  } catch { return fallback; }
}
