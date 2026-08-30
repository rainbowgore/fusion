/**
 * Functional suite from the Hermes user path.
 *
 * Proves: fusion enable hermes against the already-installed Hermes
 * (~/.hermes) → Desktop launched on that same home (not a blank profile,
 * which would open the setup wizard) → chat through Fusion gateway → mock
 * provider → Langfuse ingest tagged service:hermes → coverage FLOWING → restore.
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { test } from "node:test";
import { findFreePort } from "../src/platform/net.ts";
import { saveConfig, loadConfig } from "../src/config/load.ts";
import { getOrCreateToken } from "../src/core/auth.ts";
import { handleGateway } from "../src/core/gateway.ts";
import { enableHermes, disableHermes, hermesCaptureWired, hermesConfigFile } from "../src/sources/hermes.ts";
import { buildCoverage } from "../src/engine/coverage.ts";

function hermesOnPath(): boolean {
  const r = spawnSync("hermes", ["--help"], { encoding: "utf8", timeout: 15_000 });
  return r.status === 0 || (r.stdout + r.stderr).toLowerCase().includes("hermes");
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function killTree(pid: number, appName?: string): void {
  const kids = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  for (const line of (kids.stdout ?? "").split("\n")) {
    const c = Number(line.trim());
    if (c) killTree(c, appName);
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* gone */
  }
  if (appName) spawnSync("pkill", ["-f", appName]);
}

async function waitForCdp(port: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const pages = (await res.json()) as { type?: string; url?: string; webSocketDebuggerUrl?: string }[];
        const page = pages.find((p) => p.webSocketDebuggerUrl && (p.type === "page" || (p.url ?? "").includes("index.html")));
        const any = pages.find((p) => p.webSocketDebuggerUrl);
        const pick = page ?? any;
        if (pick?.webSocketDebuggerUrl) return pick.webSocketDebuggerUrl;
        last = JSON.stringify(pages).slice(0, 400);
      }
    } catch (err) {
      last = (err as Error).message;
    }
    await sleep(400);
  }
  throw new Error(`Hermes Desktop CDP did not come up on :${port} (${last})`);
}

async function cdpEval(wsUrl: string, expression: string, timeoutMs = 90_000): Promise<string> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("CDP websocket failed")));
  });
  const id = Math.floor(Math.random() * 1e9);
  const reply = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP evaluate timed out")), timeoutMs);
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== id) return;
      clearTimeout(timer);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(String(msg.result?.result?.value ?? ""));
    });
  });
  ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  try {
    return await reply;
  } finally {
    ws.close();
  }
}

async function cdpKey(wsUrl: string, key: string, windowsVirtualKeyCode: number): Promise<void> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("CDP websocket failed")));
  });
  let next = 1;
  const send = (method: string, params: Record<string, unknown>) => {
    const id = next++;
    ws.send(JSON.stringify({ id, method, params }));
  };
  send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode });
  send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode });
  await sleep(200);
  ws.close();
}

async function waitComposer(wsUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await cdpEval(
      wsUrl,
      `(() => {
        const el = document.querySelector('[data-slot="composer-rich-input"]') || document.querySelector('[contenteditable="true"]');
        return el ? "yes" : "no";
      })()`,
    );
    if (found === "yes") return;
    await sleep(500);
  }
  throw new Error("Hermes Desktop composer never appeared");
}

async function sendDesktopChat(wsUrl: string, text: string): Promise<void> {
  await waitComposer(wsUrl, 90_000);
  const payload = JSON.stringify(text);
  const result = await cdpEval(
    wsUrl,
    `(async () => {
      const api = window.hermesDesktop;
      if (!api?.getGatewayWsUrl) return "no-desktop-api";
      const mint = await api.getGatewayWsUrl();
      const url = typeof mint === "string" ? mint : mint && mint.ok ? mint.wsUrl : "";
      if (!url) return "no-ws:" + JSON.stringify(mint);
      const ws = new WebSocket(url);
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("gateway ws timeout")), 20000);
        ws.onopen = () => { clearTimeout(t); resolve(null); };
        ws.onerror = () => { clearTimeout(t); reject(new Error("gateway ws error")); };
      });
      const rpc = (id, method, params) => ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      const wait = (id) => new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("rpc " + id + " timeout")), 30000);
        const onMsg = (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.id !== id) return;
          clearTimeout(t);
          ws.removeEventListener("message", onMsg);
          resolve(msg);
        };
        ws.addEventListener("message", onMsg);
      });
      rpc(1, "session.create", { title: "fusion-desktop-test", source: "desktop" });
      const created = await wait(1);
      if (created.error) return "create:" + JSON.stringify(created.error);
      const sid = created.result && created.result.session_id;
      if (!sid) return "no-session:" + JSON.stringify(created);
      rpc(2, "prompt.submit", { session_id: sid, text: ${payload} });
      const submitted = await wait(2);
      ws.close();
      if (submitted.error) return "submit:" + JSON.stringify(submitted.error);
      return "ok:" + sid;
    })()`,
  );
  assert.match(result, /^ok:/, `Desktop backend did not accept the chat: ${result}`);
}

function launchHermesDesktop(opts: {
  hermesHome: string;
  userDataDir: string;
  appName: string;
  cdpPort: number;
}): { proc: ChildProcess; logs: { out: string } } {
  const yamlPath = join(opts.hermesHome, "config.yaml");
  writeFileSync(
    yamlPath,
    readFileSync(yamlPath, "utf8") +
      [
        "",
        "desktop:",
        "  electron_flags:",
        `    - --remote-debugging-port=${opts.cdpPort}`,
        "    - --remote-debugging-address=127.0.0.1",
        "    - --disable-gpu",
        "",
      ].join("\n"),
  );
  mkdirSync(opts.userDataDir, { recursive: true });
  writeFileSync(
    join(opts.userDataDir, "window-state.json"),
    JSON.stringify({ x: 40, y: 40, width: 1220, height: 800, isMaximized: false }),
  );
  const logs = { out: "" };
  const proc = spawn("hermes", ["desktop", "--skip-build"], {
    env: {
      ...process.env,
      HERMES_HOME: opts.hermesHome,
      HERMES_DESKTOP_USER_DATA_DIR: opts.userDataDir,
      HERMES_DESKTOP_APP_NAME: opts.appName,
      HERMES_DESKTOP_SKIP_QUIT_CONFIRM: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const buf = (d: Buffer) => {
    logs.out += d.toString("utf8");
  };
  proc.stdout?.on("data", buf);
  proc.stderr?.on("data", buf);
  return { proc, logs };
}

function readReq(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function anthropicSse(): string {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_fusion_test",
        type: "message",
        role: "assistant",
        model: "claude-3-5-haiku-20241022",
        content: [],
        usage: { input_tokens: 12, output_tokens: 0 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "pong" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

function startMockLangfuse(port: number): { server: Server; tags: string[][]; ingestCount: { n: number } } {
  const tags: string[][] = [];
  const ingestCount = { n: 0 };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/api/public/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (url.pathname === "/api/public/ingestion" && req.method === "POST") {
      ingestCount.n++;
      const body = JSON.parse((await readReq(req)) || "{}");
      for (const ev of body.batch ?? []) {
        if (ev?.type === "trace-create" && Array.isArray(ev.body?.tags)) tags.push(ev.body.tags);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ successes: [{}], errors: [] }));
      return;
    }
    if (url.pathname === "/api/public/traces") {
      const want = url.searchParams.getAll("tags");
      const hit = tags.some((t) => want.every((w) => t.includes(w)));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: hit ? [{ id: "t1", tags: tags.flat() }] : [], meta: { totalItems: hit ? 1 : 0 } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
  return { server, tags, ingestCount };
}

function startMockAnthropic(port: number): { server: Server; hits: { n: number; lastPath: string } } {
  const hits = { n: 0, lastPath: "" };
  const server = createServer(async (req, res) => {
    hits.n++;
    hits.lastPath = req.url ?? "";
    const raw = await readReq(req);
    let stream = false;
    try {
      stream = JSON.parse(raw || "{}").stream === true;
    } catch {
      /* ignore */
    }
    if (stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(anthropicSse());
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_fusion_test",
        type: "message",
        role: "assistant",
        model: "claude-3-5-haiku-20241022",
        content: [{ type: "text", text: "pong" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 12, output_tokens: 1 },
      }),
    );
  });
  return { server, hits };
}

test("hermes user path: enable → Hermes Desktop through Fusion → Langfuse service:hermes → coverage FLOWING → disable", { timeout: 180_000 }, async (t) => {
  if (!hermesOnPath()) {
    t.skip("hermes CLI not on PATH — cannot prove the user path");
    return;
  }

  const hermesHome = join(homedir(), ".hermes");
  const hermesYaml = join(hermesHome, "config.yaml");
  if (!existsSync(hermesYaml)) {
    t.skip("Hermes is on PATH but ~/.hermes/config.yaml is missing — not an empty-profile setup run");
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "fusion-hermes-user-"));
  const fusionHome = join(root, "fusion-data");
  const fusionCfg = join(root, "config.toml");
  const desktopUserData = join(root, "electron-user-data");
  const yamlBackup = join(root, "hermes-config.yaml.bak");
  mkdirSync(fusionHome, { recursive: true });
  mkdirSync(desktopUserData, { recursive: true });
  copyFileSync(hermesYaml, yamlBackup);

  process.env.FUSION_DATA_DIR = fusionHome;
  process.env.FUSION_CONFIG = fusionCfg;
  process.env.HERMES_HOME = hermesHome;
  delete process.env.FUSION_HERMES_CONFIG;

  const gwPort = await findFreePort(19110);
  const daemonPort = await findFreePort(gwPort + 1);
  const lfPort = await findFreePort(daemonPort + 1);
  const providerPort = await findFreePort(lfPort + 1);
  const bridgePort = await findFreePort(providerPort + 1);

  const lf = startMockLangfuse(lfPort);
  const provider = startMockAnthropic(providerPort);
  await listen(lf.server, lfPort);
  await listen(provider.server, providerPort);

  t.after(async () => {
    try {
      copyFileSync(yamlBackup, hermesYaml);
    } catch {
      /* restore best-effort */
    }
    await closeServer(lf.server);
    await closeServer(provider.server);
  });

  saveConfig({
    version: 1,
    activeTarget: "mock",
    targets: [
      {
        name: "mock",
        kind: "cloud",
        host: `http://127.0.0.1:${lfPort}`,
        publicKey: "pk-lf-test",
        secretKey: "sk-lf-test",
        project: "default",
        managed: false,
      },
    ],
    sources: { "claude-code": false, codex: false, cursor: false, hermes: false },
    ports: { ui: await findFreePort(bridgePort + 1), bridge: bridgePort, langfuseWeb: await findFreePort(bridgePort + 3), daemon: daemonPort, gateway: gwPort },
    links: [],
    endpoints: [],
  });

  const token = getOrCreateToken();
  const enabled = enableHermes(gwPort, token);
  if (!enabled.ok) {
    copyFileSync(yamlBackup, hermesYaml);
    t.skip(`fusion enable hermes refused this install: ${enabled.message}`);
    return;
  }
  assert.ok(enabled.capture, "enable must return hermesCapture for the gateway");
  const cfg = loadConfig();
  cfg.sources.hermes = true;
  cfg.hermesCapture = {
    ...enabled.capture,
    upstream: `http://127.0.0.1:${providerPort}`,
  };
  saveConfig(cfg);
  assert.match(readFileSync(hermesConfigFile(), "utf8"), /\/gw\/hermes/, "Hermes config.yaml must point at Fusion (CLI + Desktop read this file)");
  assert.equal(hermesCaptureWired(), true);

  const gatewayHits = { n: 0 };
  const gateway = createServer((req, res) => {
    gatewayHits.n++;
    handleGateway(req, res, loadConfig()).catch((e) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    });
  });
  await listen(gateway, gwPort);

  let desktop: ReturnType<typeof launchHermesDesktop> | undefined;
  let appName = "";
  t.after(async () => {
    if (desktop?.proc.pid) killTree(desktop.proc.pid, appName);
    await closeServer(gateway);
  });

  const skipBuild = spawnSync("hermes", ["desktop", "--help"], { encoding: "utf8", timeout: 15_000 });
  assert.ok(
    skipBuild.status === 0 || (skipBuild.stdout + skipBuild.stderr).toLowerCase().includes("desktop"),
    "hermes desktop must exist on PATH to run this suite",
  );

  const cdpPort = await findFreePort(gwPort + 40);
  appName = `FusionHermesDesktop-${Date.now()}`;
  desktop = launchHermesDesktop({ hermesHome, userDataDir: desktopUserData, appName, cdpPort });
  assert.equal(
    hermesConfigFile(),
    join(hermesHome, "config.yaml"),
    "Desktop and CLI share HERMES_HOME/config.yaml",
  );

  let wsUrl: string;
  try {
    wsUrl = await waitForCdp(cdpPort, 90_000);
  } catch (err) {
    throw new Error(`${(err as Error).message}\nDesktop log:\n${desktop.logs.out.slice(-4000)}`);
  }
  if (!desktop.proc.pid || desktop.proc.exitCode != null) {
    throw new Error(`Hermes Desktop exited before chat (code ${desktop.proc.exitCode})\n${desktop.logs.out.slice(-4000)}`);
  }

  const probe = `fusion-desktop-probe ${Date.now()}`;
  await sendDesktopChat(wsUrl, probe);

  const hitDeadline = Date.now() + 60_000;
  while (Date.now() < hitDeadline && gatewayHits.n === 0) await sleep(200);
  assert.ok(
    gatewayHits.n > 0,
    `gateway saw no request from Hermes Desktop. log:\n${desktop.logs.out.slice(-4000)}`,
  );
  assert.ok(provider.hits.n > 0, "provider mock saw no forwarded request from Desktop");

  const ingestDeadline = Date.now() + 15_000;
  while (Date.now() < ingestDeadline && lf.ingestCount.n === 0) await sleep(100);
  assert.ok(lf.ingestCount.n > 0, "Fusion did not ingest to Langfuse after the Desktop chat");
  assert.ok(
    lf.tags.some((tags) => tags.includes("service:hermes")),
    `Langfuse tags missing service:hermes: ${JSON.stringify(lf.tags)}`,
  );
  const coverage = await buildCoverage(loadConfig());
  const hermes = coverage.endpoints.find((e) => e.client === "hermes");
  assert.ok(hermes, "coverage has no hermes row");
  assert.equal(hermes.status, "flowing", `expected FLOWING, got ${hermes.status}: ${hermes.detail}`);

  const disabled = disableHermes(loadConfig().hermesCapture);
  assert.equal(disabled.ok, true, disabled.message);
  copyFileSync(yamlBackup, hermesYaml);
});
