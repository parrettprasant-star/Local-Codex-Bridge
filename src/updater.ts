import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const LOCAL_UPDATE_MANIFEST_ENV = "LOCAL_CODEX_BRIDGE_UPDATE_MANIFEST";

export interface LocalUpdateManifest {
  schema_version: 1;
  product: "Bridge Codex";
  version: string;
  channel: "local-dev";
  build?: string;
  notes?: string;
}

export interface UpdaterSnapshot {
  product: "Bridge Codex";
  channel: "local-dev";
  available: boolean;
  manifest_path: string | null;
  manifest: LocalUpdateManifest | null;
  error: string | null;
  auto_apply: false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, field: string, maximum: number, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || (required && value.trim().length === 0) || value.length > maximum) {
    throw new Error(field + " must be a string of at most " + maximum + " characters");
  }
  return value.trim();
}

function parseManifest(value: unknown): LocalUpdateManifest {
  if (!isRecord(value)) throw new Error("update manifest must be a JSON object");
  if (value.schema_version !== 1) throw new Error("update manifest schema_version must be 1");
  if (value.product !== "Bridge Codex") throw new Error("update manifest product must be Bridge Codex");
  if (value.channel !== "local-dev") throw new Error("update manifest channel must be local-dev");
  const result: LocalUpdateManifest = {
    schema_version: 1,
    product: "Bridge Codex",
    version: text(value.version, "version", 80, true)!,
    channel: "local-dev",
  };
  const build = text(value.build, "build", 200);
  const notes = text(value.notes, "notes", 500);
  if (build !== undefined) result.build = build;
  if (notes !== undefined) result.notes = notes;
  return result;
}

export function resolveLocalUpdateManifestFile(
  environment: NodeJS.ProcessEnv = process.env,
  currentDirectory = process.cwd(),
): string | null {
  const configured = environment[LOCAL_UPDATE_MANIFEST_ENV]?.trim();
  if (configured) {
    if (!isAbsolute(configured)) throw new Error(LOCAL_UPDATE_MANIFEST_ENV + " must be an absolute path");
    return resolve(configured);
  }
  const candidate = join(currentDirectory, "windows", "desktop", "update-manifest.local.json");
  return existsSync(candidate) ? candidate : null;
}

export class LocalManifestUpdater {
  readonly manifestPath: string | null;

  constructor(manifestPath: string | null) {
    this.manifestPath = manifestPath;
  }

  snapshot(): UpdaterSnapshot {
    if (!this.manifestPath) {
      return {
        product: "Bridge Codex",
        channel: "local-dev",
        available: false,
        manifest_path: null,
        manifest: null,
        error: null,
        auto_apply: false,
      };
    }
    try {
      const manifest = parseManifest(JSON.parse(readFileSync(this.manifestPath, "utf8")) as unknown);
      return {
        product: "Bridge Codex",
        channel: "local-dev",
        available: true,
        manifest_path: this.manifestPath,
        manifest,
        error: null,
        auto_apply: false,
      };
    } catch (error) {
      return {
        product: "Bridge Codex",
        channel: "local-dev",
        available: false,
        manifest_path: this.manifestPath,
        manifest: null,
        error: error instanceof Error ? error.message : String(error),
        auto_apply: false,
      };
    }
  }
}
