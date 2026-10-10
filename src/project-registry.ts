import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { normalizeLocalAbsolutePath, isWithinLocalRoot } from "./local-path.js";

export const PROJECT_REGISTRY_FILE_ENV = "LOCAL_CODEX_BRIDGE_PROJECTS_FILE";
export const PROJECT_REGISTRY_SCHEMA_VERSION = 1;

const MAX_PROJECT_ID_CHARS = 100;
const MAX_PROJECT_NAME_CHARS = 120;
const MAX_ROOT_PATH_CHARS = 1_000;
const MAX_CAPABILITIES = 32;
const MAX_CAPABILITY_CHARS = 100;

export interface ProjectRecord {
  project_id: string;
  project_name: string;
  root_path: string;
  allowed_capabilities: string[];
}

export interface ProjectView extends ProjectRecord {
  available: boolean;
}

export interface ProjectResolution {
  project: ProjectView;
  cwd: string;
}

export interface ProjectRegistryEnvironment {
  [PROJECT_REGISTRY_FILE_ENV]?: string;
  LOCALAPPDATA?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new Error(`${field} must be at most ${maximum} characters`);
  }
  return normalized;
}

function windowsPath(value: unknown, field: string): string {
  const normalized = text(value, field, MAX_ROOT_PATH_CHARS);
  if (normalized.includes("\0")) {
    throw new Error(`${field} contains a NUL character`);
  }
  return normalizeLocalAbsolutePath(normalized);
}

function capabilities(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_CAPABILITIES) {
    throw new Error(`allowed_capabilities must be an array with at most ${MAX_CAPABILITIES} items`);
  }
  const result: string[] = [];
  for (const candidate of value) {
    const capability = text(candidate, "allowed_capabilities item", MAX_CAPABILITY_CHARS);
    if (!result.includes(capability)) {
      result.push(capability);
    }
  }
  return result;
}

function normalizeProject(value: unknown): ProjectRecord {
  if (!isRecord(value)) {
    throw new Error("project entry must be an object");
  }
  return {
    project_id: text(value.project_id, "project_id", MAX_PROJECT_ID_CHARS),
    project_name: text(value.project_name, "project_name", MAX_PROJECT_NAME_CHARS),
    root_path: windowsPath(value.root_path, "root_path"),
    allowed_capabilities: capabilities(value.allowed_capabilities),
  };
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  return isWithinLocalRoot(rootPath, candidatePath);
}

function projectAvailable(project: ProjectRecord): boolean {
  try {
    return statSync(project.root_path).isDirectory();
  } catch {
    return false;
  }
}

export function resolveProjectRegistryFile(
  environment: ProjectRegistryEnvironment = process.env,
): string | null {
  const explicit = environment[PROJECT_REGISTRY_FILE_ENV]?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const localAppData = environment.LOCALAPPDATA?.trim();
  if (!localAppData) {
    return null;
  }
  return path.join(localAppData, "BridgeCodex", "projects.json");
}

export class ProjectRegistry {
  readonly filePath: string | null;
  readonly #projects = new Map<string, ProjectRecord>();
  #error: string | null = null;

  constructor(filePath: string | null = resolveProjectRegistryFile()) {
    this.filePath = filePath === null ? null : path.resolve(filePath);
    this.#load();
  }

  register(projectValue: unknown): ProjectRecord {
    const project = normalizeProject(projectValue);
    if (this.#projects.has(project.project_id)) {
      throw new Error(`project_id is already registered: ${project.project_id}`);
    }
    this.#projects.set(project.project_id, project);
    this.#error = null;
    return { ...project, allowed_capabilities: [...project.allowed_capabilities] };
  }

  list(): ProjectView[] {
    return [...this.#projects.values()].map((project) => ({
      ...project,
      allowed_capabilities: [...project.allowed_capabilities],
      available: projectAvailable(project),
    }));
  }

  get(projectId: string): ProjectView {
    const project = this.#projects.get(projectId);
    if (!project) {
      throw new Error(`project_id is not registered: ${projectId}`);
    }
    return {
      ...project,
      allowed_capabilities: [...project.allowed_capabilities],
      available: projectAvailable(project),
    };
  }

  resolve(projectId: string, cwd?: string): ProjectResolution {
    const project = this.get(projectId);
    if (!project.available) {
      throw new Error(`project root is not available: ${project.project_id}`);
    }
    const resolvedCwd = cwd ?? project.root_path;
    if (!isWithinRoot(project.root_path, resolvedCwd)) {
      throw new Error(`cwd is outside project root: ${project.project_id}`);
    }
    return { project, cwd: resolvedCwd };
  }

  status(): { configured: boolean; status: "ready" | "empty" | "error"; error: string | null } {
    if (this.#error) {
      return { configured: this.filePath !== null, status: "error", error: this.#error };
    }
    return {
      configured: this.filePath !== null,
      status: this.#projects.size > 0 ? "ready" : "empty",
      error: null,
    };
  }

  #load(): void {
    if (!this.filePath || !existsSync(this.filePath)) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
      if (!isRecord(parsed) || (parsed.schema_version !== undefined && parsed.schema_version !== PROJECT_REGISTRY_SCHEMA_VERSION)) {
        throw new Error("unsupported project registry schema_version");
      }
      if (!Array.isArray(parsed.projects)) {
        throw new Error("project registry projects must be an array");
      }
      const loaded = new Map<string, ProjectRecord>();
      for (const value of parsed.projects) {
        const project = normalizeProject(value);
        if (loaded.has(project.project_id)) {
          throw new Error(`duplicate project_id: ${project.project_id}`);
        }
        loaded.set(project.project_id, project);
      }
      for (const [id, project] of loaded) {
        this.#projects.set(id, project);
      }
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
      this.#projects.clear();
    }
  }
}
