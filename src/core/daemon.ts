import { createReadStream, existsSync } from "node:fs";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config/schema.js";
import { loadConfig } from "../config/load.js";
import { buildCoverage } from "../engine/coverage.js";
import { consoleHtml } from "../ui/page.js";
import { handleGateway } from "./gateway.js";
import { getOrCreateToken, originAllowed, sessionCookieHeader, tokenValid } from "./auth.js";
import { resolveBindHost } from "../platform/bind.js";
import { CONTROL_JSON_MAX } from "../platform/limits.js";
import { warn } from "../platform/log.js";
import { clearPid } from "./state.js";
import { startDrainer } from "./buffer.js";
import { govTargetTest, govTargetAdd, govTargetSetKeys, govProjectLink, govPricesSync, govEnableSource, govSetActive } from "./govern.js";
import { runHealthChecks } from "../health.js";

function assetsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "assets");
}

function providerAssetDir(): string {
  return join(assetsDir(), "providers");
}

function tryServeFont(url: URL, res: ServerResponse): boolean {
  if (!url.pathname.startsWith("/fonts/")) return false;
  const name = basename(url.pathname);
  if (!/^[A-Za-z0-9._-]+\.(ttf|otf|woff2)$/.test(name)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return true;
  }
  const file = join(assetsDir(), "fonts", name);
  if (!existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return true;
  }
  const type = name.endsWith(".otf") ? "font/otf" : name.endsWith(".woff2") ? "font/woff2" : "font/ttf";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=86400" });
  createReadStream(file).pipe(res);
  return true;
}

function tryServeFavicon(url: URL, res: ServerResponse): boolean {
  if (url.pathname !== "/favicon.svg" && url.pathname !== "/favicon.ico") return false;
  const file = join(assetsDir(), "favicon.svg");
  if (!existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return true;
  }
  res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
  createReadStream(file).pipe(res);
  return true;
}

function tryServeProviderLogo(url: URL, res: ServerResponse): boolean {
  if (!url.pathname.startsWith("/providers/")) return false;
  const name = basename(url.pathname);
  if (!/^[a-z0-9-]+\.(png|svg)$/.test(name)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return true;
  }
  const file = join(providerAssetDir(), name);
  if (!existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return true;
  }
  const type = name.endsWith(".svg") ? "image/svg+xml" : "image/png";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=86400" });
  createReadStream(file).pipe(res);
  return true;
}

/**
 * The core daemon. Control/API/UI on ports.daemon, model gateway on ports.gateway.
 * Read endpoints are open on localhost; mutating /control/* endpoints require the
 * session token AND a same-origin check (browsers can POST to localhost freely).
 */
export function startCore(startupCfg: Config): { control: Server; gateway: Server; close: () => Promise<void> } {
  const token = getOrCreateToken();
  const port = startupCfg.ports.daemon;

  const control = createServer((req, res) =>
    handleControl(req, res, port, token).catch((e) => sendJson(res, 500, { error: String(e) })),
  );
  const gateway = createServer((req, res) =>
    handleGateway(req, res, freshConfig(startupCfg)).catch((e) => sendJson(res, 500, { error: String(e) })),
  );

  const onListenError = (which: string, p: number) => (err: NodeJS.ErrnoException) => {
    console.error(err.code === "EADDRINUSE" ? `${which} port :${p} already in use — is a daemon already running?` : `${which} listen error: ${err.message}`);
    clearPid(); // don't leave a stale pidfile pointing at a crashed daemon
    process.exit(1);
  };
  control.once("error", onListenError("control", port));
  gateway.once("error", onListenError("gateway", startupCfg.ports.gateway));
  const bind = resolveBindHost();
  control.listen(port, bind);
  gateway.listen(startupCfg.ports.gateway, bind);
  startDrainer(); // replay any durably-buffered emissions when Langfuse recovers

  const priceSyncInterval = startPeriodicPriceSync();

  const close = () =>
    Promise.all([
      new Promise<void>((r) => control.close(() => r())),
      new Promise<void>((r) => gateway.close(() => r())),
    ]).then(() => {
      clearInterval(priceSyncInterval);
    });

  return { control, gateway, close };
}

/** Reload config fresh each request so daemon reflects CLI/UI mutations; fall back to snapshot. */
/** Re-sync model prices in the background so they do not go stale. Runs every 24h. */
function startPeriodicPriceSync(ms = 24 * 60 * 60 * 1000): ReturnType<typeof setInterval> {
  const run = async () => {
    try {
      await govPricesSync();
    } catch {
      /* best-effort background refresh; failures surface on next manual sync */
    }
  };
  // stagger first run to avoid slowing daemon startup
  setTimeout(run, 5000);
  return setInterval(run, ms);
}

function freshConfig(fallback: Config): Config {
  try {
    return loadConfig();
  } catch {
    return fallback;
  }
}

async function handleControl(req: IncomingMessage, res: ServerResponse, daemonPort: number, token: string): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const cfg = (() => {
    try {
      return loadConfig();
    } catch {
      return null;
    }
  })();

  if (tryServeFont(url, res)) return;
  if (tryServeFavicon(url, res)) return;
  if (tryServeProviderLogo(url, res)) return;

  if (url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "fusion-core", activeTarget: cfg?.activeTarget, ports: cfg?.ports, targets: cfg?.targets.length ?? 0 });
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": sessionCookieHeader(token),
    });
    res.end(consoleHtml({ govern: true }));
    return;
  }

  if (url.pathname === "/api/health") {
    const checks = await runHealthChecks(url.searchParams.get("deep") === "1");
    return sendJson(res, 200, { checks });
  }

  if (url.pathname === "/api/coverage") {
    if (!cfg) return sendJson(res, 503, { error: "no config" });
    return sendJson(res, 200, await buildCoverage(cfg, { live: url.searchParams.get("lite") !== "1" }));
  }

  // ---- Mutating Govern API (token + same-origin required) ----
  if (url.pathname.startsWith("/control/")) {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
    if (!originAllowed(req, daemonPort)) return sendJson(res, 403, { error: "cross-origin blocked" });
    if (!tokenValid(req, token)) return sendJson(res, 401, { error: "bad or missing x-fusion-token" });

    const body = await readJson(req);
    const action = url.pathname.slice("/control/".length);
    try {
      switch (action) {
        case "target-test":
          return sendJson(res, 200, await govTargetTest(body));
        case "target-add":
          return sendJson(res, 200, await govTargetAdd(body));
        case "target-set-keys":
          return sendJson(res, 200, await govTargetSetKeys(body));
        case "project-link":
          return sendJson(res, 200, govProjectLink(body));
        case "prices-sync":
          return sendJson(res, 200, await govPricesSync());
        case "enable-source":
          return sendJson(res, 200, govEnableSource(body));
        case "set-active":
          return sendJson(res, 200, govSetActive(body));
        default:
          return sendJson(res, 404, { error: `unknown action "${action}"` });
      }
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
      if (s.length > CONTROL_JSON_MAX) {
        req.destroy();
        resolve({});
      }
    });
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (err) {
        warn("control json parse failed", { error: String(err) });
        resolve({});
      }
    });
  });
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
