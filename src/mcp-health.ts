export type McpBindingState = "ACTIVE_SESSION" | "UNBOUND" | "UNKNOWN";

export interface McpHealthSnapshot {
  endpoint: "stdio";
  initialized: boolean;
  active_requests: number;
  last_tool_call_at: string | null;
  last_error: string | null;
  binding: McpBindingState;
  chatgpt_conversation_binding: "UNKNOWN" | "UNBOUND";
}

export class McpHealthState {
  #initialized = false;
  #activeRequests = 0;
  #lastToolCallAt: string | null = null;
  #lastError: string | null = null;

  initialized(): void {
    this.#initialized = true;
  }

  requestStarted(): void {
    this.#activeRequests += 1;
    this.#lastToolCallAt = new Date().toISOString();
  }

  requestFinished(): void {
    this.#activeRequests = Math.max(0, this.#activeRequests - 1);
  }

  requestFailed(message: string): void {
    this.#lastError = message.slice(0, 2_000);
  }

  status(): McpHealthSnapshot {
    return {
      endpoint: "stdio",
      initialized: this.#initialized,
      active_requests: this.#activeRequests,
      last_tool_call_at: this.#lastToolCallAt,
      last_error: this.#lastError,
      binding: this.#initialized ? "ACTIVE_SESSION" : "UNBOUND",
      chatgpt_conversation_binding: "UNKNOWN",
    };
  }
}
