import path from "node:path";

/** Lexical normalization for stored paths. Execution still validates the host OS and realpath. */
export function normalizeLocalAbsolutePath(value: string, allowOuterQuotes = false): string {
  const candidate = allowOuterQuotes && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1) : value;
  if (candidate.includes("\0")) throw new Error("path contains a NUL character");
  if (/^(?:\\\\|\/\/|\\[?.]\\)/.test(candidate)) throw new Error("path must not be a UNC or Windows device path");
  if (!candidate || candidate.length > 1_000 || candidate !== candidate.trim() ||
      /[\0\r\n]/.test(candidate) || /^["']|["']$/.test(candidate)) {
    throw new Error("path must be a bounded absolute path without quotes or control characters");
  }
  if (/^[A-Za-z]:[\\/]/.test(candidate)) {
    const normalized = path.win32.normalize(candidate);
    return normalized.length > 3 ? normalized.replace(/\\+$/, "") : normalized;
  }
  if (candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\")) {
    return path.posix.normalize(candidate).replace(/\/$/, "") || "/";
  }
  throw new Error("path must be an absolute Windows drive-letter or macOS/POSIX path");
}

export function canonicalizeLocalPath(value: string): string {
  const normalized = normalizeLocalAbsolutePath(value);
  return normalized.startsWith("/") ? normalized : normalized.toLowerCase();
}

export function isWithinLocalRoot(root: string, candidate: string): boolean {
  const normalizedRoot = canonicalizeLocalPath(root);
  const normalizedCandidate = canonicalizeLocalPath(candidate);
  const separator = normalizedRoot.startsWith("/") ? "/" : "\\";
  const prefix = normalizedRoot.endsWith(separator) ? normalizedRoot : normalizedRoot + separator;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(prefix);
}
