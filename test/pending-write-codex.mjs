import readline from "node:readline";

if (process.argv.slice(2).join(" ") !== "app-server --listen stdio://") {
  process.exit(64);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "pending-write-codex" } });
    lines.pause();
    setTimeout(() => lines.resume(), 120);
    return;
  }
  if (message.method === "test/after") {
    send({ id: message.id, result: { after: true } });
  }
});

lines.on("close", () => process.exit(0));
