import readline from "node:readline";

const [delayArg, ...appServerArgs] = process.argv.slice(2);
if (appServerArgs.join(" ") !== "app-server --listen stdio://") {
  process.exit(64);
}
const responseDelayMs = Number(delayArg);
if (!Number.isInteger(responseDelayMs) || responseDelayMs < 1) {
  process.exit(65);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const counts = {
  threadStart: 0,
  threadResume: 0,
  turnStart: 0,
  turnSteer: 0,
  turnInterrupt: 0,
};
let threadCounter = 0;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function later(callback, extraMs = 0) {
  setTimeout(callback, responseDelayMs + extraMs);
}

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "late-response-codex" } });
    return;
  }
  if (message.method === "initialized") {
    return;
  }
  if (message.method === "test/state") {
    send({ id: message.id, result: { ...counts } });
    return;
  }
  if (message.method === "thread/start") {
    counts.threadStart += 1;
    threadCounter += 1;
    const threadId = message.params.testThreadId ?? `late-thread-${threadCounter}`;
    if (message.params.testLateError === true) {
      later(() => send({
        id: message.id,
        error: { code: -32001, message: "late thread start failure" },
      }));
      later(() => send({
        id: message.id,
        result: { thread: { id: threadId } },
      }), 20);
      return;
    }
    later(() => send({ id: message.id, result: { thread: { id: threadId } } }));
    return;
  }
  if (message.method === "thread/resume") {
    counts.threadResume += 1;
    later(() => send({
      id: message.id,
      result: { thread: { id: message.params.threadId } },
    }));
    return;
  }
  if (message.method === "turn/start") {
    counts.turnStart += 1;
    const threadId = message.params.threadId;
    const turnId = `turn-${threadId}`;
    if (threadId === "thread-native-started") {
      setTimeout(() => send({
        method: "turn/started",
        params: { threadId, turn: { id: turnId, status: "inProgress" } },
      }), Math.floor(responseDelayMs / 2));
    }
    if (threadId === "thread-native-terminal") {
      setTimeout(() => send({
        method: "turn/completed",
        params: {
          threadId,
          turn: {
            id: turnId,
            status: "completed",
            items: [{ type: "agentMessage", text: "TERMINAL" }],
          },
        },
      }), Math.floor(responseDelayMs / 2));
    }
    later(() => send({
      id: message.id,
      result: { turn: { id: turnId, status: "inProgress" } },
    }));
    return;
  }
  if (message.method === "turn/steer") {
    counts.turnSteer += 1;
    if (message.params.testLateError === true) {
      later(() => send({
        id: message.id,
        error: {
          code: -32002,
          message: "late steer error api_key=FAKE_FIXTURE_SECRET_1234567890",
        },
      }));
    } else {
      later(() => send({
        id: message.id,
        result: { turnId: message.params.expectedTurnId },
      }));
    }
    return;
  }
  if (message.method === "turn/interrupt") {
    counts.turnInterrupt += 1;
    later(() => send({ id: message.id, result: {} }));
    return;
  }
  if (message.id !== undefined) {
    send({ id: message.id, error: { code: -32601, message: `unknown ${message.method}` } });
  }
});

lines.on("close", () => process.exit(0));
