import { randomInt } from "node:crypto";
import { TaskStatusServer as ProductionTaskStatusServer } from "../src/status-server.js";

type ServerArguments = ConstructorParameters<typeof ProductionTaskStatusServer>;

// Exercise the real local-client handshake. This is not a production bypass.
export async function authorizedLocalFetch(base: string): Promise<typeof fetch> {
  const session = await globalThis.fetch(new URL("/api/local-session", base), {
    headers: { "X-Bridge-Local-Client": "1" },
  });
  if (!session.ok) throw new Error("Test local authorization handshake failed");
  const { request_token } = await session.json() as { request_token: string };
  return async (input, options) => {
    const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (target.origin !== new URL(base).origin) throw new Error("Test client must stay on its isolated listener");
    const headers = new Headers(options?.headers);
    if (!["GET", "HEAD"].includes(options?.method?.toUpperCase() ?? "GET")) headers.set("X-Bridge-Request-Token", request_token);
    return await globalThis.fetch(input, { ...options, headers });
  };
}

// Test-only listener selection. Some Windows hosts assign port:0 below 15000,
// including fetch/browser-denied service ports. Never change production ports.
export class TaskStatusServer {
  readonly #arguments: ServerArguments;
  #server: ProductionTaskStatusServer;

  constructor(...args: ServerArguments) {
    this.#arguments = args;
    this.#server = this.#create();
  }

  #create(): ProductionTaskStatusServer {
    const [store, manager, runtime, options] = this.#arguments;
    return new ProductionTaskStatusServer(store, manager, runtime, {
      ...options,
      port: options.port === 0 ? randomInt(49_152, 65_536) : options.port,
    });
  }

  async start(): ReturnType<ProductionTaskStatusServer["start"]> {
    for (let attempt = 0; attempt < 16; attempt++) {
      try {
        return await this.#server.start();
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (this.#arguments[3].port !== 0 || code !== "EADDRINUSE" || attempt === 15) throw error;
        await this.#server.close();
        this.#server = this.#create();
      }
    }
    throw new Error("Could not allocate an isolated browser-safe test listener");
  }

  async close(): Promise<void> {
    await this.#server.close();
  }
}
