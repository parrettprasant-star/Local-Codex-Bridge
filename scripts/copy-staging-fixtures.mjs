import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, "..", "test");
const destination = join(root, "..", ".staging", "dist", "test");
const relativeFixtureDestination = join(root, "..", ".staging", "test");
mkdirSync(destination, { recursive: true });
mkdirSync(relativeFixtureDestination, { recursive: true });
for (const name of readdirSync(source)) {
  if (name.endsWith(".mjs")) {
    copyFileSync(join(source, name), join(destination, name));
    copyFileSync(join(source, name), join(relativeFixtureDestination, name));
  }
}
