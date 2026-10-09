import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

export const STATUS_URL_FILE_ENV = "LOCAL_CODEX_BRIDGE_STATUS_URL_FILE";

export interface PortLease {
  generation: string;
  host: "127.0.0.1";
  port: number;
  url: string;
  state: "ready" | "stopped";
  updated_at: string;
}

function validPath(value: string): string {
  const normalized = value.trim();
  if (!normalized || !isAbsolute(normalized) || /[\0\r\n]/.test(normalized)) {
    throw new Error(`${STATUS_URL_FILE_ENV} must be an absolute path without control characters`);
  }
  return resolve(normalized);
}

export function resolveStatusUrlFile(environment: NodeJS.ProcessEnv = process.env): string | null {
  const configured = environment[STATUS_URL_FILE_ENV]?.trim();
  return configured ? validPath(configured) : null;
}

export class PortRegistry {
  readonly #filePath: string | null;
  readonly #generation: string;

  constructor(filePath: string | null, generation: string = randomUUID()) {
    this.#filePath = filePath === null ? null : validPath(filePath);
    this.#generation = generation;
  }

  generation(): string {
    return this.#generation;
  }

  publishReady(port: number): PortLease | null {
    if (this.#filePath === null) return null;
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("status port must be an integer from 1 to 65535 when published");
    }
    const lease: PortLease = {
      generation: this.#generation,
      host: "127.0.0.1",
      port,
      url: `http://127.0.0.1:${port}/api/status`,
      state: "ready",
      updated_at: new Date().toISOString(),
    };
    this.#write(lease);
    return { ...lease };
  }

  publishStopped(): PortLease | null {
    if (this.#filePath === null) return null;
    const lease: PortLease = {
      generation: this.#generation,
      host: "127.0.0.1",
      port: 0,
      url: "",
      state: "stopped",
      updated_at: new Date().toISOString(),
    };
    this.#write(lease);
    return { ...lease };
  }

  read(): PortLease | null {
    if (this.#filePath === null) return null;
    try {
      const value = JSON.parse(readFileSync(this.#filePath, "utf8")) as Partial<PortLease>;
      if (
        value.generation !== this.#generation ||
        value.host !== "127.0.0.1" ||
        (value.state !== "ready" && value.state !== "stopped") ||
        typeof value.port !== "number" ||
        typeof value.url !== "string" ||
        typeof value.updated_at !== "string"
      ) return null;
      return value as PortLease;
    } catch {
      return null;
    }
  }

  #write(value: PortLease): void {
    if (this.#filePath === null) return;
    const directory = dirname(this.#filePath);
    mkdirSync(directory, { recursive: true });
    const temporary = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
      renameSync(temporary, this.#filePath);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
