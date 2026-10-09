import { appendFileSync } from "node:fs";
import readline from "node:readline";

const [logPath, ...appServerArgs] = process.argv.slice(2);
if (!logPath || appServerArgs.join(" ") !== "app-server --listen stdio://") {
  process.exit(64);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "duplicate-request-codex" } });
    return;
  }
  if (message.method === "initialized") {
    return;
  }
  if (message.method === "test/duplicate") {
    send({
      id: 17,
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread-original", turnId: "turn-original", marker: "original" },
    });
    send({
      id: "17",
      method: "item/tool/requestUserInput",
      params: { threadId: "thread-string", turnId: "turn-string", marker: "string" },
    });
    send({
      id: 17,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-duplicate", turnId: "turn-duplicate", marker: "duplicate" },
    });
    return;
  }
  if ((message.id === 17 || message.id === "17") && message.method === undefined) {
    appendFileSync(logPath, `ambiguous-response:${JSON.stringify(message)}\n`, "utf8");
  }
});

lines.on("close", () => {
  appendFileSync(logPath, "stdin-closed\n", "utf8");
  process.exit(0);
});
