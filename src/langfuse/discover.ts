import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TargetSchema, type Config, type Target } from "../config/schema.js";
import { loadConfig, saveConfig } from "../config/load.js";
import { targetHasKeys } from "../config/credentials.js";
import { cursorMcpPath, hermesConfigPath } from "../mcp/install.js";
import { LangfuseClient } from "./client.js";
import { readStackInfo } from "./stack.js";
import { CLOUD_HEALTH_PROBE_MS, DOCKER_PS_TIMEOUT_MS, LISTEN_PROBE_MS, LOCAL_HEALTH_PROBE_MS } from "../platform/limits.js";
import { warn } from "../platform/log.js";

const pexec = promisify(execFile);

export type DiscoverSource = "docker" | "listen" | "env" | "mcp" | "config";

export interface DiscoveredLangfuse {
  host: string;
  kind: "local" | "cloud";
  source: DiscoverSource;
  healthy: boolean;
  hasKeys: boolean;
  projects: Array<{ id: string; name: string }>;
}

export interface DiscoveredWithCreds extends DiscoveredLangfuse {
  publicKey: string;
  secretKey: string;
}

export function looksLikeLangfuseHealth(body: unknown, httpStatus: number): boolean {
  if (httpStatus < 200 || httpStatus >= 300) return false;
  if (!body || typeof body !== "object") return false;
  const rec = body as Record<string, unknown>;
  const status = rec.status;
  return status === "OK" || status === "ok" || typeof rec.version === "string";
}

export function originFromLangfuseUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function parseBasicAuthHeader(header: string): { publicKey: string; secretKey: string } | null {
  const m = header.trim().match(/^Basic\s+(\S+)/i);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i < 1) return null;
    const publicKey = decoded.slice(0, i).trim();
    const secretKey = decoded.slice(i + 1).trim();
    if (!publicKey.startsWith("pk-lf-") || !secretKey.startsWith("sk-lf-")) return null;
    return { publicKey, secretKey };
  } catch {
    return null;
  }
}

export function parseLsofListenPorts(stdout: string): number[] {
  const ports = new Set<number>();
  for (const line of stdout.split("\n")) {
    const m = line.match(/:(?<port>\d+)\s+\(LISTEN\)/);
    if (!m?.groups) continue;
    const p = Number(m.groups.port);
    if (p >= 80 && p <= 65535) ports.add(p);
  }
  return [...ports].sort((a, b) => a - b);
}

const LANGFUSE_SIDECAR = /clickhouse|redis|minio|postgres|pgvector/i;
const LANGFUSE_WEB_IMAGE = /langfuse\/langfuse(?!-worker)/i;
const LANGFUSE_WEB_NAME = /langfuse[-_]web\b/i;

/** `docker ps` name/image line is Langfuse web, not worker or stack sidecars. */
export function isLangfuseWebPsLine(line: string): boolean {
  const [name = "", image = ""] = line.split("\t");
  const blob = `${name} ${image} ${line}`;
  if (LANGFUSE_SIDECAR.test(blob)) return false;
  if (/langfuse[-_]worker|langfuse\/langfuse-worker/i.test(blob)) return false;
  return LANGFUSE_WEB_IMAGE.test(blob) || LANGFUSE_WEB_NAME.test(name) || LANGFUSE_WEB_NAME.test(line);
}

/** Host ports published from Langfuse web (container 3000), not Redis/ClickHouse/MinIO. */
export function parseDockerLangfusePorts(ps: string): number[] {
  const ports = new Set<number>();
  for (const line of ps.split("\n")) {
    if (!isLangfuseWebPsLine(line)) continue;
    for (const m of line.matchAll(/:(\d+)->3000\b/g)) ports.add(Number(m[1]));
  }
  return [...ports];
}

function kindForHost(host: string): "local" | "cloud" {
  try {
    const h = new URL(host).hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "::1") return "local";
    if (h.endsWith("langfuse.com")) return "cloud";
    return h.includes("localhost") ? "local" : "cloud";
  } catch {
    return "local";
  }
}

function credsFromEnv(env: NodeJS.ProcessEnv = process.env): { host?: string; publicKey: string; secretKey: string } {
  const host = (env.LANGFUSE_HOST || env.LANGFUSE_BASEURL || env.LANGFUSE_BASE_URL || "").trim();
  const publicKey = (env.LANGFUSE_PUBLIC_KEY || env.LANGFUSE_PK || "").trim();
  const secretKey = (env.LANGFUSE_SECRET_KEY || env.LANGFUSE_SK || "").trim();
  return { host: host || undefined, publicKey, secretKey };
}

function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return out;
}

async function probeHealth(host: string, timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${host.replace(/\/+$/, "")}/api/public/health`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      return false;
    }
    return looksLikeLangfuseHealth(body, res.status);
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function collectMcpHostsAndKeys(): Array<{ host: string; publicKey: string; secretKey: string; source: DiscoverSource }> {
  const out: Array<{ host: string; publicKey: string; secretKey: string; source: DiscoverSource }> = [];
  const files = [cursorMcpPath()];
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as { mcpServers?: Record<string, { url?: string; headers?: Record<string, string> }> };
      for (const [name, spec] of Object.entries(data.mcpServers ?? {})) {
        const url = spec.url ?? "";
        if (!/langfuse/i.test(name) && !/langfuse/i.test(url)) continue;
        const host = originFromLangfuseUrl(url);
        if (!host) continue;
        const keys = spec.headers?.Authorization ? parseBasicAuthHeader(spec.headers.Authorization) : null;
        out.push({ host, publicKey: keys?.publicKey ?? "", secretKey: keys?.secretKey ?? "", source: "mcp" });
      }
    } catch (err) {
      warn("mcp config unreadable", { file, error: String(err) });
    }
  }
  const hermes = hermesConfigPath();
  if (existsSync(hermes)) {
    try {
      const raw = readFileSync(hermes, "utf8");
      const url = raw.match(/https?:\/\/[^\s"'\\]+langfuse[^\s"'\\]*/i)?.[0];
      const host = url ? originFromLangfuseUrl(url) : null;
      if (host) out.push({ host, publicKey: "", secretKey: "", source: "mcp" });
    } catch (err) {
      warn("hermes config unreadable", { error: String(err) });
    }
  }
  return out;
}

export async function dockerLangfuseScan(): Promise<{ ok: boolean; hosts: string[]; detail: string }> {
  if (process.env.FUSION_SKIP_DISCOVER === "1") {
    return { ok: true, hosts: [], detail: "discover skipped" };
  }
  try {
    const { stdout } = await pexec("docker", ["ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Ports}}"], { timeout: DOCKER_PS_TIMEOUT_MS });
    const hosts = parseDockerLangfusePorts(stdout).map((p) => `http://127.0.0.1:${p}`);
    return {
      ok: true,
      hosts,
      detail: hosts.length ? hosts.join(", ") : "Docker is up, no Langfuse container",
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    const blob = `${e.message ?? ""} ${e.stderr ?? ""} ${e.code ?? ""}`;
    const off =
      e.code === "ENOENT" ||
      /Cannot connect to the Docker daemon|Is the docker daemon running|Cannot connect to docker|connect.*docker\.sock/i.test(blob);
    const detail = off ? "Docker is off" : `Docker error: ${e.message || "docker ps failed"}`;
    if (!off) warn("docker ps failed", { error: e.message, code: e.code });
    return { ok: false, hosts: [], detail };
  }
}

export async function dockerLangfuseHosts(): Promise<string[]> {
  return (await dockerLangfuseScan()).hosts;
}

async function listenLangfuseHosts(skip: Set<number>): Promise<string[]> {
  let stdout = "";
  try {
    ({ stdout } = await pexec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { timeout: 5000 }));
  } catch {
    return [];
  }
  const known = [3000, 3001, 3030, 3100, 4012, 4688].filter((p) => !skip.has(p));
  const ports = [...new Set([...known, ...parseLsofListenPorts(stdout).filter((p) => !skip.has(p) && p >= 1024)])];
  const capped = ports.slice(0, 64);
  const hosts: string[] = [];
  const chunk = 8;
  for (let i = 0; i < capped.length; i += chunk) {
    const slice = capped.slice(i, i + chunk);
    const found = await Promise.all(
      slice.map(async (p) => {
        const host = `http://127.0.0.1:${p}`;
        return (await probeHealth(host, LISTEN_PROBE_MS)) ? host : null;
      }),
    );
    for (const h of found) if (h) hosts.push(h);
  }
  return hosts;
}

/** Match keys to a host. Never reuse cloud keys on a local origin (or the reverse). */
export function mergeCreds(
  host: string,
  bags: Array<{ host?: string; publicKey: string; secretKey: string }>,
): { publicKey: string; secretKey: string } {
  const origin = originFromLangfuseUrl(host) ?? host;
  for (const b of bags) {
    if (!b.publicKey || !b.secretKey) continue;
    if (!b.host) continue;
    if (originFromLangfuseUrl(b.host) === origin) return { publicKey: b.publicKey, secretKey: b.secretKey };
  }
  const hostless = bags.find((b) => !b.host && b.publicKey && b.secretKey);
  if (hostless && kindForHost(origin) === "cloud") {
    return { publicKey: hostless.publicKey, secretKey: hostless.secretKey };
  }
  return { publicKey: "", secretKey: "" };
}

export function parseLangfuseInitEnvLines(lines: string[]): { publicKey: string; secretKey: string; projectId: string } | null {
  const map = new Map<string, string>();
  for (const line of lines) {
    const i = line.indexOf("=");
    if (i < 1) continue;
    map.set(line.slice(0, i), line.slice(i + 1).trim());
  }
  const publicKey = map.get("LANGFUSE_INIT_PROJECT_PUBLIC_KEY") ?? "";
  const secretKey = map.get("LANGFUSE_INIT_PROJECT_SECRET_KEY") ?? "";
  const projectId = map.get("LANGFUSE_INIT_PROJECT_ID") ?? "";
  if (!publicKey.startsWith("pk-lf-") || !secretKey.startsWith("sk-lf-")) return null;
  return { publicKey, secretKey, projectId };
}

type DockerInspectRow = {
  Config?: { Image?: string; Env?: string[] };
  NetworkSettings?: { Ports?: Record<string, Array<{ HostPort?: string }> | null> };
};

/** Web publish port + init keys from `docker inspect` JSON (tests + live). */
export function targetsFromDockerInspect(rows: unknown): Array<{ host: string; publicKey: string; secretKey: string; project: string }> {
  if (!Array.isArray(rows)) return [];
  const out: Array<{ host: string; publicKey: string; secretKey: string; project: string }> = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const row = raw as DockerInspectRow;
    const image = String(row.Config?.Image ?? "");
    if (/worker/i.test(image) && !row.NetworkSettings?.Ports?.["3000/tcp"]) continue;
    const keys = parseLangfuseInitEnvLines(row.Config?.Env ?? []);
    if (!keys) continue;
    const binds = row.NetworkSettings?.Ports?.["3000/tcp"];
    const port = binds?.[0]?.HostPort;
    if (!port) continue;
    const host = `http://127.0.0.1:${port}`;
    if (seen.has(host)) continue;
    seen.add(host);
    out.push({ host, publicKey: keys.publicKey, secretKey: keys.secretKey, project: keys.projectId || "default" });
  }
  return out;
}

export async function dockerLangfuseInitTargets(): Promise<Array<{ host: string; publicKey: string; secretKey: string; project: string }>> {
  try {
    const { stdout: list } = await pexec("docker", ["ps", "--format", "{{.Names}}\t{{.Image}}"], { timeout: DOCKER_PS_TIMEOUT_MS });
    const names = list
      .split("\n")
      .filter((line) => isLangfuseWebPsLine(line))
      .map((line) => line.split("\t")[0]?.trim())
      .filter((n): n is string => Boolean(n));
    if (!names.length) return [];
    const { stdout } = await pexec("docker", ["inspect", ...names], { timeout: 8000 });
    return targetsFromDockerInspect(JSON.parse(stdout));
  } catch (err) {
    warn("docker inspect for Langfuse keys failed", { error: String(err) });
    return [];
  }
}

/**
 * Find Langfuse the user already has: Docker, MCP configs, env, and local
 * processes that answer Langfuse's public health endpoint. Does not assume a port.
 */
export async function discoverLangfuse(cfg?: Config, opts: { scanListen?: boolean } = {}): Promise<DiscoveredWithCreds[]> {
  if (process.env.FUSION_SKIP_DISCOVER === "1") return [];

  const skip = new Set<number>([cfg?.ports.daemon, cfg?.ports.gateway, cfg?.ports.bridge].filter((n): n is number => typeof n === "number"));
  const envCreds = credsFromEnv();
  const fileCreds = {
    ...credsFromEnv(readDotEnv(join(homedir(), ".env")) as NodeJS.ProcessEnv),
  };
  const mcp = collectMcpHostsAndKeys();
  const bags = [
    envCreds,
    fileCreds,
    ...mcp.map((m) => ({ host: m.host, publicKey: m.publicKey, secretKey: m.secretKey })),
  ];

  const candidates = new Map<string, DiscoverSource>();
  const add = (host: string, source: DiscoverSource) => {
    const origin = originFromLangfuseUrl(host);
    if (!origin) return;
    if (!candidates.has(origin)) candidates.set(origin, source);
  };

  if (envCreds.host) add(envCreds.host, "env");
  if (fileCreds.host) add(fileCreds.host, "env");
  for (const m of mcp) add(m.host, "mcp");
  for (const t of cfg?.targets ?? []) if (t.host) add(t.host, "config");
  const stack = readStackInfo();
  if (stack?.host) {
    add(stack.host, "docker");
    bags.push({ host: stack.host, publicKey: stack.publicKey, secretKey: stack.secretKey });
  }
  if (cfg?.ports.langfuseWeb) add(`http://127.0.0.1:${cfg.ports.langfuseWeb}`, "listen");
  for (const h of await dockerLangfuseHosts()) add(h, "docker");
  const scanListen = opts.scanListen ?? true;
  if (scanListen) {
    for (const h of await listenLangfuseHosts(skip)) add(h, "listen");
  }

  const rows: DiscoveredWithCreds[] = [];
  for (const [host, source] of candidates) {
    const keys = mergeCreds(host, bags);
    const timeout = kindForHost(host) === "cloud" ? CLOUD_HEALTH_PROBE_MS : LOCAL_HEALTH_PROBE_MS;
    const healthy = await probeHealth(host, timeout);
    let projects: Array<{ id: string; name: string }> = [];
    const org =
      cfg?.targets.find((t) => {
        try {
          return new URL(t.host).origin === new URL(host).origin && t.orgPublicKey && t.orgSecretKey;
        } catch {
          return false;
        }
      }) ?? null;
    try {
      if (org?.orgPublicKey && org.orgSecretKey) {
        projects = await new LangfuseClient({
          host,
          publicKey: org.orgPublicKey,
          secretKey: org.orgSecretKey,
        }).listOrganizationProjects();
      } else if (keys.publicKey && keys.secretKey) {
        projects = await new LangfuseClient({ host, publicKey: keys.publicKey, secretKey: keys.secretKey }).listProjects();
      }
    } catch (err) {
      warn("listProjects failed during discover", { host, error: String(err) });
      projects = [];
    }
    rows.push({
      host,
      kind: kindForHost(host),
      source,
      healthy,
      hasKeys: Boolean(keys.publicKey && keys.secretKey),
      projects,
      publicKey: keys.publicKey,
      secretKey: keys.secretKey,
    });
  }
  return rows;
}

export function publicDiscovery(rows: DiscoveredWithCreds[]): DiscoveredLangfuse[] {
  return rows.map(({ publicKey: _pk, secretKey: _sk, ...rest }) => rest);
}

function targetNameFor(host: string, kind: "local" | "cloud"): string {
  if (kind === "cloud") {
    try {
      const h = new URL(host).hostname.replace(/[^a-z0-9]+/gi, "-");
      return h.startsWith("cloud") ? "cloud" : h.slice(0, 40);
    } catch {
      return "cloud";
    }
  }
  try {
    const p = new URL(host).port || (new URL(host).protocol === "https:" ? "443" : "80");
    return `local-${p}`;
  } catch {
    return "local";
  }
}

/** Persist discovered host+keys so Fusion keeps using them. */
export function rememberDiscovered(cfg: Config, found: DiscoveredWithCreds[]): boolean {
  let changed = false;
  for (const d of found) {
    const existing = cfg.targets.find((t) => originFromLangfuseUrl(t.host) === d.host);
    if (existing) {
      if (d.hasKeys && d.publicKey && d.secretKey && !targetHasKeys(existing)) {
        existing.publicKey = d.publicKey;
        existing.secretKey = d.secretKey;
        if (d.projects[0]?.name) existing.project = d.projects[0].name;
        changed = true;
      }
      continue;
    }
    if (!d.hasKeys && !(d.healthy && d.kind === "local")) continue;
    const name = uniqueName(cfg, targetNameFor(d.host, d.kind));
    cfg.targets.push(
      TargetSchema.parse({
        name,
        kind: d.kind,
        host: d.host,
        publicKey: d.publicKey,
        secretKey: d.secretKey,
        project: d.projects[0]?.name ?? "default",
        managed: false,
      }),
    );
    changed = true;
  }
  if (preferExistingLocalActive(cfg)) changed = true;
  return changed;
}

/** If a local Langfuse is on this machine, Fusion uses it (not cloud-by-default). */
export function preferExistingLocalActive(cfg: Config): boolean {
  const localKeyed = cfg.targets.find((t) => t.kind === "local" && targetHasKeys(t));
  const localAny = cfg.targets.find((t) => t.kind === "local");
  const keyed = cfg.targets.find((t) => targetHasKeys(t));
  const pick = localKeyed ?? localAny ?? keyed ?? cfg.targets[0];
  if (!pick || cfg.activeTarget === pick.name) return false;
  cfg.activeTarget = pick.name;
  return true;
}

export function formatDiscovery(found: DiscoveredWithCreds[]): string[] {
  if (found.length === 0) return ["No Langfuse instance found yet (Docker, MCP config, env, local health)."];
  return found.map((d) => {
    const proj = d.projects.length ? ` projects: ${d.projects.map((p) => p.name).join(", ")}` : "";
    const keys = d.hasKeys ? "keys" : "no keys";
    const health = d.healthy ? "up" : "stored";
    return `${d.kind}  ${d.host}  (${d.source}, ${health}, ${keys})${proj}`;
  });
}

export async function ensureLangfuse(cfg: Config): Promise<{ found: DiscoveredWithCreds[]; target: Target | null }> {
  const found = await discoverAndRemember(cfg);
  if (preferExistingLocalActive(cfg)) saveConfig(cfg);
  const name = cfg.activeTarget;
  const target = cfg.targets.find((t) => t.name === name) ?? cfg.targets.find((t) => t.kind === "local") ?? cfg.targets[0] ?? null;
  return { found, target };
}

function uniqueName(cfg: Config, base: string): string {
  if (!cfg.targets.some((t) => t.name === base)) return base;
  let i = 2;
  while (cfg.targets.some((t) => t.name === `${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export async function discoverAndRemember(cfg: Config, opts?: { scanListen?: boolean }): Promise<DiscoveredWithCreds[]> {
  const found = await discoverLangfuse(cfg, opts);
  if (rememberDiscovered(cfg, found)) saveConfig(cfg);
  return found;
}
