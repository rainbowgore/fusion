import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { backupFile } from "../platform/paths.js";

export class McpConfigError extends Error {}

export function cursorMcpPath(): string {
  return join(homedir(), ".cursor", "mcp.json");
}

export function hermesConfigPath(): string {
  const home = process.env.HERMES_HOME?.trim() || join(homedir(), ".hermes");
  return join(home, "config.yaml");
}

function yamlScalar(s: string): string {
  if (s === "" || /[:#{}[\],&*?|>!%@`'"]/.test(s) || /\s/.test(s) || /^-/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

export function fusionHermesMcpBlock(): string {
  const { command, args } = fusionMcpInvocation();
  const lines = [`  fusion:`, `    command: ${yamlScalar(command)}`, `    args:`];
  for (const a of args) lines.push(`      - ${yamlScalar(a)}`);
  lines.push(`    enabled: true`);
  return lines.join("\n") + "\n";
}

/** Drop an existing `  fusion:` mapping so reconnect is idempotent. */
export function stripHermesMcpServer(raw: string, name: string): string {
  const re = new RegExp(`^  ${name}:\\n(?:    .*\\n)*`, "gm");
  return raw.replace(re, "");
}

export function mergeHermesFusionMcp(raw: string): string {
  const block = fusionHermesMcpBlock();
  const without = stripHermesMcpServer(raw, "fusion");
  if (/^mcp_servers:\s*$/m.test(without) || /^mcp_servers:\s*\n/m.test(without)) {
    return without.replace(/^mcp_servers:[ \t]*\n/m, `mcp_servers:\n${block}`);
  }
  const trimmed = without.replace(/\s*$/, "\n");
  return `${trimmed}\nmcp_servers:\n${block}`;
}

export function writeHermesFusionMcp(path = hermesConfigPath()): string | null {
  if (!existsSync(path)) {
    throw new McpConfigError(
      `No Hermes config at ${path}. Open Hermes Desktop once (or set HERMES_HOME), then re-run \`fusion connect hermes\`.`,
    );
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new McpConfigError(`Could not read ${path}: ${(err as Error).message}`);
  }
  const merged = mergeHermesFusionMcp(raw);
  const backup = backupFile(path, "config.yaml");
  writeFileSync(path, merged, { encoding: "utf8" });
  return backup;
}

/** Parse MCP JSON. Corrupt files must not be treated as empty (that would wipe other servers). */
export function parseMcpJson(raw: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new McpConfigError("MCP config is not valid JSON");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new McpConfigError("MCP config must be a JSON object");
  }
  return data as Record<string, unknown>;
}

export function readMcpConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new McpConfigError(`Could not read ${path}: ${(err as Error).message}`);
  }
  try {
    return parseMcpJson(raw);
  } catch (err) {
    if (err instanceof McpConfigError) throw err;
    throw new McpConfigError(
      `${path} is not valid JSON. Fix or restore it, then re-run \`fusion connect\`. Fusion will not overwrite a corrupt file.`,
    );
  }
}

/** Absolute stdio launch so GUI clients (Cursor, Hermes Desktop) do not need `fusion` on PATH. */
export function fusionMcpInvocation(extraArgs: string[] = []): { command: string; args: string[] } {
  const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const dist = join(pkgRoot, "dist", "cli.js");
  const src = join(pkgRoot, "src", "cli.ts");
  const tsx = join(pkgRoot, "node_modules", ".bin", "tsx");
  if (existsSync(dist)) return { command: process.execPath, args: [dist, "mcp", ...extraArgs] };
  if (existsSync(tsx) && existsSync(src)) return { command: tsx, args: [src, "mcp", ...extraArgs] };
  return { command: "fusion", args: ["mcp", ...extraArgs] };
}

/** Fusion + Langfuse MCP entries with no secrets. Langfuse keys stay in config.toml. */
export function fusionMcpServers(): Record<string, unknown> {
  const fusion = fusionMcpInvocation();
  const langfuse = fusionMcpInvocation(["--langfuse"]);
  return {
    fusion: { command: fusion.command, args: fusion.args },
    langfuse: { command: langfuse.command, args: langfuse.args },
  };
}

export function mergeMcpServers(
  existing: Record<string, unknown>,
  servers: Record<string, unknown>,
): Record<string, unknown> {
  const prev =
    existing.mcpServers && typeof existing.mcpServers === "object" && !Array.isArray(existing.mcpServers)
      ? (existing.mcpServers as Record<string, unknown>)
      : {};
  return { ...existing, mcpServers: { ...prev, ...servers } };
}

export function writeMcpConfig(path: string, doc: Record<string, unknown>): string | null {
  const backup = backupFile(path, `mcp.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return backup;
}
