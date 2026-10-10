// Independently gated preview package; never rewrites the Windows release.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = resolve(process.argv[2] || ".staging/mac-tunnel-build");
const output = resolve(process.argv[3] || "artifacts/macos-preview");
if (process.platform !== "darwin") throw new Error("Build and test Mac packages on actual macOS");
if (existsSync(work) || existsSync(output)) throw new Error("Fresh work and output directories required");
mkdirSync(work, { recursive: true }); mkdirSync(output, { recursive: true });
function run(file, args, cwd = root, env = process.env, capture = false) {
  const result = spawnSync(file, args, { cwd, env, encoding: "utf8", stdio: capture ? "pipe" : "inherit", timeout: 300000 });
  if (result.status !== 0) throw new Error(file + " failed; do not distribute package");
  return result.stdout;
}
const go = run("go", ["version"], root, process.env, true).trim();
if (!/^go version go1\.27\.2 darwin\/(amd64|arm64)$/.test(go)) throw new Error("Pinned native Go 1.27.2 required");
const sourceUrl = "https://github.com/openai/tunnel-client/releases/download/v0.0.16/tunnel-client-runtime-source-v0.0.16.tar.gz";
const expected = "88953678325ffe650cc562bbd0b147e7e8e984b0527aa8b1647b02d6660ce9e0";
const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error("Official source download failed");
const archive = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(archive).digest("hex") !== expected) throw new Error("Official source checksum mismatch");
writeFileSync(join(work, "runtime-source.tar.gz"), archive);
run("/usr/bin/tar", ["-xf", join(work, "runtime-source.tar.gz"), "-C", work]);
const source = join(work, "tunnel-client-runtime-source-v0.0.16");
const env = { ...process.env, GOTOOLCHAIN: "local", GOWORK: "off", CGO_ENABLED: "0", GOENV: "off", GOFLAGS: "-mod=mod", GOPROXY: "https://proxy.golang.org", GOSUMDB: "sum.golang.org", GOBIN: join(work, "tools"), GOPATH: join(work, "modules"), GOCACHE: join(work, "cache"), GOPRIVATE: "", GONOSUMDB: "", GONOPROXY: "" };
const changes = ["golang.org/x/net@v0.60.0", "go.opentelemetry.io/otel@v1.45.0", "go.opentelemetry.io/otel/sdk@v1.45.0", "go.opentelemetry.io/otel/sdk/metric@v1.45.0", "go.opentelemetry.io/otel/metric@v1.45.0", "go.opentelemetry.io/otel/trace@v1.45.0"];
run("go", ["get", ...changes], source, env);
const binary = join(output, "tunnel-client");
const flags = "-X github.com/openai/tunnel-client/pkg/version.semanticVersion=0.0.16-lcb.1 -X github.com/openai/tunnel-client/pkg/version.GitSHA=5f99daabd4aa4a77049e6d81d54a0d8c18335397 -X github.com/openai/tunnel-client/pkg/version.GoVersion=go1.27.2 -X github.com/openai/tunnel-client/pkg/version.Flavor=runtime";
run("go", ["build", "-trimpath", "-buildvcs=false", "-ldflags", flags, "-o", binary, "./cmd/client-runtime"], source, env);
run("go", ["install", "golang.org/x/vuln/cmd/govulncheck@v1.8.0"], source, env);
const scan = spawnSync(join(env.GOBIN, "govulncheck"), ["-mode=binary", "-scan=symbol", binary], { env, encoding: "utf8", timeout: 180000 });
writeFileSync(join(output, "VULNERABILITY-CHECK.txt"), scan.stdout + scan.stderr);
if (scan.status !== 0) throw new Error("Known vulnerability scan failed; no package publication");
const info = run("go", ["version", "-m", binary], source, env, true).split(/\r?\n/);
info[0] = "tunnel-client: go1.27.2";
writeFileSync(join(output, "BUILD-INFO.txt"), info.join("\n"));
const modules = [];
for (const line of info) {
  const match = line.match(/^\s*dep\s+(\S+)\s+(\S+)\s+(\S+)/);
  if (!match) continue;
  const [, name, version, go_sum] = match;
  const metadata = JSON.parse(run("go", ["list", "-m", "-json", name], source, env, true));
  const licenses = readdirSync(metadata.Dir).filter((file) => /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/.test(file));
  if (!licenses.length) throw new Error("Missing dependency license: " + name);
  const destination = join(output, "licenses", name.replaceAll("/", "_") + "@" + version);
  mkdirSync(destination, { recursive: true });
  for (const file of licenses) copyFileSync(join(metadata.Dir, file), join(destination, file));
  modules.push({ name, version, go_sum });
}
for (const [from, to] of [["LICENSE", "LICENSE-Tunnel.txt"], ["NOTICE", "NOTICE-Tunnel.txt"], ["go.mod", "go.mod"], ["go.sum", "go.sum"]]) copyFileSync(join(source, from), join(output, to));
const goRoot = run("go", ["env", "GOROOT"], source, env, true).trim();
copyFileSync(join(goRoot, "LICENSE"), join(output, "LICENSE-Go.txt"));
writeFileSync(join(output, "TUNNEL-PROVENANCE.json"), JSON.stringify({ upstream: "https://github.com/openai/tunnel-client", upstream_tag: "v0.0.16", upstream_commit: "5f99daabd4aa4a77049e6d81d54a0d8c18335397", source_sha256: expected, go: "go1.27.2", changes, modified_runtime: true, official_binary: false, notarized: false, architecture: process.arch, modules }, null, 2));
writeFileSync(join(output, "tunnel-client.version.txt"), "0.0.16-lcb.1 (community dependency-repair build)\n");
writeFileSync(join(output, "package.json"), JSON.stringify({ name: "local-codex-bridge", version: "6.2.0-macos-preview", build_label: "macos-browser-host-preview", private: true, type: "module", engines: { node: ">=24" } }, null, 2));
cpSync(join(root, ".staging", "dist", "src"), join(output, "dist", "src"), { recursive: true });
mkdirSync(join(output, "scripts"));
copyFileSync(join(root, "scripts", "macos-bridge.mjs"), join(output, "scripts", "macos-bridge.mjs"));
for (const file of ["README.md", "LICENSE", "MACOS.zh-CN.md", "CHATGPT-PLUGIN-SETUP.zh-CN.md", "CHATGPT-PROMPTS.zh-CN.md", "START-HERE.zh-CN.md", "USER-GUIDE.zh-CN.md", "SCREENSHOT-GUIDE.zh-CN.md", "SECURITY.md", "TUNNEL-SETUP.md", "PRIVACY-RELEASE.zh-CN.md"]) copyFileSync(join(root, file), join(output, file));
cpSync(join(root, "docs", "images", "quickstart"), join(output, "docs", "images", "quickstart"), { recursive: true });
copyFileSync(join(root, "projects.json.example"), join(output, "projects.json.example"));
const manifest = [];
function collect(directory, prefix = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error("No symlinks in release payload");
    if (entry.isDirectory()) collect(join(directory, entry.name), relative + "/");
    else {
      if (/(?:auth\.json|\.env|task_records|task_status|config\.json|profile\.yaml|projects\.json|sessions|history|\.lock|\.log)$/i.test(relative)) throw new Error("Private/runtime file in package: " + relative);
      manifest.push({ file: relative, bytes: readFileSync(join(directory, entry.name)).length, sha256: createHash("sha256").update(readFileSync(join(directory, entry.name))).digest("hex") });
    }
  }
}
collect(output);
writeFileSync(join(output, "PACKAGE-MANIFEST.json"), JSON.stringify({ platform: "darwin", architecture: process.arch, channel: "preview", files: manifest }, null, 2));
// upload-artifact loses executable permission on loose files. Distribute an
// archive and verify extraction, hashes and executable mode before uploading.
const archiveName = `LocalCodexBridge-macos-${process.arch}-preview.tar.gz`;
const releaseArchive = join(dirname(output), archiveName);
if (existsSync(releaseArchive)) throw new Error("Refuse to replace a release archive");
run("/usr/bin/tar", ["-czf", releaseArchive, "-C", dirname(output), basename(output)]);
const extracted = join(work, "archive-readback");
mkdirSync(extracted);
run("/usr/bin/tar", ["-xzf", releaseArchive, "-C", extracted]);
const unpacked = join(extracted, basename(output));
for (const item of [...manifest, { file: "PACKAGE-MANIFEST.json", sha256: createHash("sha256").update(readFileSync(join(output, "PACKAGE-MANIFEST.json"))).digest("hex") }]) {
  if (createHash("sha256").update(readFileSync(join(unpacked, item.file))).digest("hex") !== item.sha256) throw new Error("Archive readback mismatch: " + item.file);
}
if (!(statSync(join(unpacked, "tunnel-client")).mode & 0o111)) throw new Error("Archive lost executable permission");
run(join(unpacked, "tunnel-client"), ["--version"]);
writeFileSync(join(dirname(output), `SHA256SUMS-macos-${process.arch}.txt`), createHash("sha256").update(readFileSync(releaseArchive)).digest("hex") + "  " + archiveName + "\n");
console.log("MACOS_PACKAGE=PASS arch=" + process.arch + " known_vulnerability_scan=PASS");
console.log("MACOS_ARCHIVE_READBACK=PASS executable_mode=preserved");
