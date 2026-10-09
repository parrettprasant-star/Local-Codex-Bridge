import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export class LocalHttpSecurityError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "LocalHttpSecurityError";
  }
}

// A browser/CSRF boundary, not a sandbox against another process running as the
// same Windows user. Tokens are scoped to this listener lifetime, never saved.
export class LocalHttpSecurity {
  readonly #token = randomBytes(32).toString("hex");

  validate(request: IncomingMessage, port: number): void {
    const counts = new Map<string, number>();
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      const name = request.rawHeaders[i]?.toLowerCase() ?? "";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    for (const name of ["host", "origin", "sec-fetch-site", "x-bridge-request-token", "content-type"]) {
      if ((counts.get(name) ?? 0) > 1) throw new LocalHttpSecurityError(403, "Ambiguous local request headers");
    }
    const host = request.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      throw new LocalHttpSecurityError(403, "Invalid local request host");
    }
    if (!request.url?.startsWith("/") || request.url.startsWith("//")) {
      throw new LocalHttpSecurityError(403, "Invalid local request target");
    }
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) {
      throw new LocalHttpSecurityError(403, "Cross-origin local requests are not allowed");
    }
    const site = request.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none") {
      throw new LocalHttpSecurityError(403, "Cross-site local requests are not allowed");
    }
    const method = request.method ?? "GET";
    if (method === "GET" || method === "HEAD") return;
    if (method === "OPTIONS") throw new LocalHttpSecurityError(403, "Cross-origin preflight is not allowed");
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      throw new LocalHttpSecurityError(405, "Unsupported local request method");
    }
    const token = request.headers["x-bridge-request-token"];
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) ||
        !timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(this.#token, "hex"))) {
      throw new LocalHttpSecurityError(403, "Local request authorization expired or missing; reload the Control Center");
    }
    const contentType = request.headers["content-type"];
    const hasBody = Number(request.headers["content-length"] ?? 0) > 0 || request.headers["transfer-encoding"] !== undefined;
    if ((hasBody || contentType !== undefined) &&
        (typeof contentType !== "string" || contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")) {
      throw new LocalHttpSecurityError(415, "Local request bodies must use application/json");
    }
  }

  render(html: string): string {
    return html.replace("<head>", `<head>\n<meta name="bridge-request-token" content="${this.#token}">`);
  }

  session(request: IncomingMessage): { request_token: string } {
    // This custom header forces an untrusted browser origin to preflight. No
    // CORS permission is issued. Local CLI clients can explicitly bootstrap.
    if (request.headers["x-bridge-local-client"] !== "1") {
      throw new LocalHttpSecurityError(403, "Local client bootstrap header is required");
    }
    return { request_token: this.#token };
  }
}
