/**
 * Shared harness for multi-surface functional tests.
 * Isolates Fusion config/data + client homes under a temp root.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { saveConfig, loadConfig } from "../../src/config/load.ts";
import { getOrCreateToken, getOrCreateGatewayToken } from "../../src/core/auth.ts";
import { startCore } from "../../src/core/daemon.ts";
import type { Config } from "../../src/config/schema.ts";
import { recordAction, recordSkip } from "./report.ts";

const PKG_ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");

export type MockLangfuse = {
  port: number;
  host: string;
  server: Server;
  tags: string[][];
  models: Array<{ id: string; modelName: string; matchPattern: string }>;
  ingestCount: { n: number };
  close: () => Promise<void>;
};

export type MockUpstream = {
  port: number;
  host: string;
  server: Server;
  hits: { n: number; lastPath: string };
  close: () => Promise<void>;
};

export type FunctionalEnv = {
  root: string;
  home: string;
  configPath: string;
  dataDir: string;
  linkRoot: string;
  hermesHome: string;
  codexConfig: string;
  cursorMcp: string;
  env: NodeJS.ProcessEnv;
  lf: MockLangfuse;
  ports: { daemon: number; gateway: number; bridge: number; ui: number };
  applyEnv: () => void;
  writeBaseConfig: (extra?: Partial<Config>) => Config;
  close: () => Promise<void>;
};

function readReq(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      resolve(p);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Bind an ephemeral port (avoids TOCTOU races from probe-then-listen). */
export async function allocatePort(): Promise<number> {
  const s = createServer();
  const p = await listen(s, 0);
  await closeServer(s);
  return p;
}

export async function startMockLangfuse(_port?: number): Promise<MockLangfuse> {
  const tags: string[][] = [];
  const models: Array<{ id: string; modelName: string; matchPattern: string }> = [];
  const ingestCount = { n: 0 };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/api/public/health") {
      return json(200, { status: "ok" });
    }
    if (url.pathname === "/api/public/ingestion" && req.method === "POST") {
      ingestCount.n++;
      try {
        const body = JSON.parse((await readReq(req)) || "{}");
        for (const ev of body.batch ?? []) {
          if (ev?.type === "trace-create" && Array.isArray(ev.body?.tags)) tags.push(ev.body.tags);
        }
      } catch {
        /* ignore bad body */
      }
      return json(200, { successes: [{}], errors: [] });
    }
    if (url.pathname === "/api/public/traces") {
      const want = url.searchParams.getAll("tags");
      const hit = want.length === 0 ? tags.length > 0 : tags.some((t) => want.every((w) => t.includes(w)));
      return json(200, {
        data: hit ? [{ id: "t1", tags: tags.flat(), timestamp: new Date().toISOString() }] : [],
        meta: { page: 1, limit: 50, totalItems: hit ? 1 : 0, totalPages: 1 },
      });
    }
    if (url.pathname === "/api/public/projects") {
      return json(200, { data: [{ id: "p1", name: "default" }] });
    }
    if (url.pathname === "/api/public/models") {
      if (req.method === "POST") {
        const body = JSON.parse((await readReq(req)) || "{}");
        const id = `m${models.length + 1}`;
        models.push({
          id,
          modelName: String(body.modelName ?? "unknown"),
          matchPattern: String(body.matchPattern ?? ".*"),
        });
        return json(200, { id, ...body });
      }
      return json(200, {
        data: models,
        meta: { page: 1, limit: 100, totalItems: models.length, totalPages: 1 },
      });
    }
    if (url.pathname === "/api/public/observations") {
      return json(200, { data: [], meta: { page: 1, limit: 50, totalItems: 0, totalPages: 0 } });
    }
    return json(200, {});
  });
  const p = await listen(server, 0);
  return {
    port: p,
    host: `http://127.0.0.1:${p}`,
    server,
    tags,
    models,
    ingestCount,
    close: () => closeServer(server),
  };
}

export async function startMockUpstream(_port?: number): Promise<MockUpstream> {
  const hits = { n: 0, lastPath: "" };
  const server = createServer(async (req, res) => {
    hits.n++;
    hits.lastPath = req.url ?? "";
    await readReq(req);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-fusion-test",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
    );
  });
  const p = await listen(server, 0);
  return {
    port: p,
    host: `http://127.0.0.1:${p}`,
    server,
    hits,
    close: () => closeServer(server),
  };
}

/** Snapshot + restore process.env keys touched by the harness. */
function captureEnv(keys: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of keys) out[k] = process.env[k];
  return out;
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const ENV_KEYS = [
  "HOME",
  "FUSION_CONFIG",
  "FUSION_DATA_DIR",
  "FUSION_CODEX_CONFIG",
  "FUSION_HERMES_CONFIG",
  "HERMES_HOME",
  "FUSION_LINK_ROOT",
  "FUSION_SKIP_DISCOVER",
  "FUSION_STACK_DIR",
  "XDG_CONFIG_HOME",
];

export async function createFunctionalEnv(opts: { skipDiscover?: boolean } = {}): Promise<FunctionalEnv> {
  const root = mkdtempSync(join(tmpdir(), "fusion-func-"));
  const home = join(root, "home");
  const dataDir = join(root, "fusion-data");
  const configPath = join(root, "config.toml");
  const linkRoot = join(root, "projects");
  const hermesHome = join(home, ".hermes");
  const codexConfig = join(home, ".codex", "config.toml");
  const cursorMcp = join(home, ".cursor", "mcp.json");

  mkdirSync(home, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(linkRoot, { recursive: true });
  mkdirSync(join(home, ".cursor"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  mkdirSync(hermesHome, { recursive: true });
  writeFileSync(join(hermesHome, "config.yaml"), "model:\n  provider: openai\n  base_url: https://api.openai.com\n", "utf8");
  writeFileSync(codexConfig, "# codex test config\n", "utf8");

  const lf = await startMockLangfuse();
  // Ephemeral ports — never reuse fixed preferences (parallel tests + startCore exits on EADDRINUSE).
  const daemon = await allocatePort();
  const gateway = await allocatePort();
  const bridge = await allocatePort();
  const ui = await allocatePort();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    FUSION_CONFIG: configPath,
    FUSION_DATA_DIR: dataDir,
    FUSION_CODEX_CONFIG: codexConfig,
    HERMES_HOME: hermesHome,
    FUSION_LINK_ROOT: linkRoot,
    FUSION_STACK_DIR: join(root, "langfuse-stack"),
    ...(opts.skipDiscover !== false ? { FUSION_SKIP_DISCOVER: "1" } : {}),
  };
  delete env.FUSION_HERMES_CONFIG;

  const prev = captureEnv(ENV_KEYS);

  const applyEnv = () => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete process.env.FUSION_HERMES_CONFIG;
  };

  applyEnv();

  const writeBaseConfig = (extra: Partial<Config> = {}): Config => {
    applyEnv();
    const cfg: Config = {
      version: 1,
      activeTarget: "mock",
      sink: "gateway-only",
      targets: [
        {
          name: "mock",
          kind: "cloud",
          host: lf.host,
          publicKey: "pk-lf-test",
          secretKey: "sk-lf-test",
          project: "default",
          managed: false,
        },
      ],
      sources: { "claude-code": false, codex: false, cursor: false, hermes: false },
      ports: { ui, bridge, daemon, gateway },
      links: [],
      endpoints: [],
      ...extra,
    };
    saveConfig(cfg);
    return loadConfig();
  };

  return {
    root,
    home,
    configPath,
    dataDir,
    linkRoot,
    hermesHome,
    codexConfig,
    cursorMcp,
    env,
    lf,
    ports: { daemon, gateway, bridge, ui },
    applyEnv,
    writeBaseConfig,
    close: async () => {
      await lf.close();
      restoreEnv(prev);
    },
  };
}

export function cliBin(): { command: string; argsPrefix: string[] } {
  const dist = join(PKG_ROOT, "dist", "cli.js");
  const src = join(PKG_ROOT, "src", "cli.ts");
  const tsx = join(PKG_ROOT, "node_modules", ".bin", "tsx");
  if (existsSync(dist)) return { command: process.execPath, argsPrefix: [dist] };
  if (existsSync(tsx) && existsSync(src)) return { command: tsx, argsPrefix: [src] };
  return { command: "npx", argsPrefix: ["tsx", src] };
}

export type CliResult = { status: number; stdout: string; stderr: string };

/**
 * Run the Fusion CLI as a child process.
 * Must be async (spawn, not spawnSync): the parent often hosts mock HTTP servers
 * that need the event loop to answer the child's fetches.
 */
export function runCli(args: string[], env: NodeJS.ProcessEnv, timeoutMs = 60_000): Promise<CliResult> {
  const { command, argsPrefix } = cliBin();
  return new Promise((resolve) => {
    const child = spawn(command, [...argsPrefix, ...args], {
      env,
      cwd: PKG_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ status: 124, stdout, stderr: stderr + `\n(timeout after ${timeoutMs}ms)` });
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ status: 1, stdout, stderr: stderr + String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? 1, stdout, stderr });
    });
  });
}

export async function waitForUrl(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = (err as Error).message;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}: ${last}`);
}

export type CoreHandle = {
  close: () => Promise<void>;
  token: string;
  gatewayToken: string;
  daemonPort: number;
  gatewayPort: number;
};

export async function startDaemonInProcess(cfg: Config): Promise<CoreHandle> {
  const core = startCore(cfg);
  const token = getOrCreateToken();
  const gatewayToken = getOrCreateGatewayToken();
  await waitForUrl(`http://127.0.0.1:${cfg.ports.daemon}/health`);
  return {
    token,
    gatewayToken,
    daemonPort: cfg.ports.daemon,
    gatewayPort: cfg.ports.gateway,
    close: core.close,
  };
}

export async function callControl(
  daemonPort: number,
  token: string,
  action: string,
  body: Record<string, unknown> = {},
  opts: { origin?: string | null; tokenHeader?: string | null } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.tokenHeader !== null) headers["x-fusion-token"] = opts.tokenHeader ?? token;
  if (opts.origin !== null) headers.Origin = opts.origin ?? `http://127.0.0.1:${daemonPort}`;
  const res = await fetch(`http://127.0.0.1:${daemonPort}/control/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

export function readClientConfig(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function commandAvailable(bin: string): boolean {
  const r = spawnSync(bin, ["--help"], { encoding: "utf8", timeout: 15_000 });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") return false;
  return r.status === 0 || Boolean(r.stdout) || Boolean(r.stderr);
}

export function appInstalled(appName: string): boolean {
  if (process.platform !== "darwin") return false;
  const r = spawnSync("osascript", ["-e", `id of application "${appName}"`], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return r.status === 0;
}

/** Speak MCP JSON-RPC over stdio to `fusion mcp`. */
export async function withMcpClient<T>(
  env: NodeJS.ProcessEnv,
  fn: (callTool: (name: string, args?: Record<string, unknown>) => Promise<string>) => Promise<T>,
): Promise<T> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const { command, argsPrefix } = cliBin();
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") cleanEnv[k] = v;
  }
  const transport = new StdioClientTransport({
    command,
    args: [...argsPrefix, "mcp"],
    env: cleanEnv,
    stderr: "pipe",
  });
  const client = new Client({ name: "fusion-functional-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const callTool = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      const content = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
      return content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text!)
        .join("\n");
    };
    return await fn(callTool);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** In-process MCP fallback via buildMcpServer (faster local iteration). */
export async function callMcpToolInProcess(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const { buildMcpServer } = await import("../../src/mcp/server.ts");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const server = buildMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "fusion-functional-inproc", version: "0.0.0" });
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name, arguments: args });
    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
    return content
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text!)
      .join("\n");
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

export { recordAction, recordSkip };
