import readline from "node:readline";

if (process.argv.slice(2).join(" ") !== "app-server --listen stdio://") {
  process.exit(64);
}

let requestCount = 0;
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

lines.on("line", (line) => {
  const message = JSON.parse(line);
  requestCount += 1;
  if (message.method === "initialize") {
    process.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: "timeout-codex" } })}\n`);
    return;
  }
  if (message.method === "test/count") {
    process.stdout.write(`${JSON.stringify({ id: message.id, result: { requestCount } })}\n`);
  }
});

lines.on("close", () => process.exit(0));
