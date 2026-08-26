import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { Config } from "../config/schema.js";
import { activeTarget } from "../config/load.js";
import { LangfuseClient, type IngestionEvent } from "../langfuse/client.js";
import { resolveProvider, parseSseData, type Usage } from "./providers.js";
import { gatewayCredentialValid } from "./auth.js";
import { recordIngest } from "./signals.js";
import { spool } from "./buffer.js";

/**
 * The model gateway: the universal capture chokepoint. A client points its model
 * base URL at http://localhost:<gateway>/k/<token>/gw/<provider>; every call is
 * forwarded to the real provider (client's own Authorization — BYOK, no provider
 * key stored), then logged to Langfuse tagged by client + routed project/target.
 *
 * Auth: the session token is required (header `x-fusion-token` OR the `/k/<token>/`
 * path prefix), so a random localhost web page cannot drive the gateway.
 *
 * Routing headers: x-fusion-project, x-fusion-target, x-fusion-client.
 */
const MAX_BODY = 25 * 1024 * 1024; // 25 MB request cap
const MAX_ACC = 4 * 1024 * 1024; // cap on SSE text we retain for usage parsing
const UPSTREAM_TIMEOUT_MS = 120_000;

export async function handleGateway(req: IncomingMessage, res: ServerResponse, cfg: Config): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  let path = url.pathname;

  // Token may ride in a leading /k/<token>/ segment (so base-URL clients can auth).
  let pathToken: string | undefined;
  const kmatch = /^\/k\/([^/]+)(\/gw\/.*)$/.exec(path);
  if (kmatch) {
    pathToken = kmatch[1];
    path = kmatch[2];
  }
  const token = header(req, "x-fusion-token") ?? pathToken;
  if (!token || !gatewayCredentialValid(token)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "gateway requires the Fusion gateway token (x-fusion-token header or /k/<token>/ path)" }));
    return;
  }

  const m = /^\/gw\/([^/]+)(\/.*)?$/.exec(path);
  if (!m) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "gateway path must be /gw/<provider>/... (optionally /k/<token>/gw/...)" }));
    return;
  }
  const providerSlug = m[1];
  let rest = m[2] ?? "/";
  // Hermes native Anthropic only honors model.base_url if the path looks like
  // an Anthropic-compatible proxy (`…/anthropic`). Strip that marker before
  // forwarding to the real upstream (`/v1/messages`).
  if (providerSlug === "hermes" && (rest === "/anthropic" || rest.startsWith("/anthropic/"))) {
    rest = rest.slice("/anthropic".length) || "/";
  }
  const envOverride = process.env[`FUSION_UPSTREAM_${providerSlug.toUpperCase()}`];
  const cfgOverride =
    providerSlug === "hermes"
      ? cfg.hermesCapture?.upstream
      : cfg.endpoints.find((e) => e.name === providerSlug || e.client === "generic")?.upstream;
  const provider = resolveProvider(providerSlug, envOverride ?? cfgOverride, {
    hermesShape: cfg.hermesCapture?.shape,
  });
  if (!provider) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `unknown provider "${providerSlug}"` }));
    return;
  }

  const project = header(req, "x-fusion-project") || cfg.defaultProject;
  const targetName = header(req, "x-fusion-target");
  const client = header(req, "x-fusion-client") || (providerSlug === "hermes" ? "hermes" : "generic");

  let reqBody: Buffer;
  try {
    reqBody = await readBody(req, MAX_BODY);
  } catch (err) {
    res.writeHead(413, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (err as Error).message }));
    return;
  }
  let reqJson: any = null;
  try {
    reqJson = reqBody.length ? JSON.parse(reqBody.toString("utf8")) : null;
  } catch {
    /* non-JSON body — forward as-is, no usage capture */
  }
  const streaming = reqJson?.stream === true;

  // For streaming, ask the upstream to include usage in-stream where it can.
  let sendBody = reqBody;
  if (streaming && provider.ensureStreamUsage && reqJson) {
    const modified = provider.ensureStreamUsage(reqJson);
    if (modified !== reqJson) sendBody = Buffer.from(JSON.stringify(modified));
  }

  const upstreamUrl = provider.upstream + rest + url.search;
  const fwdHeaders = forwardHeaders(req);
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: fwdHeaders,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : sendBody,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `gateway upstream failed: ${(err as Error).message}` }));
    return;
  }

  const status = upstream.status;
  const respHeaders: Record<string, string> = {};
  upstream.headers.forEach((v, k) => {
    if (k.toLowerCase() !== "content-encoding" && k.toLowerCase() !== "content-length") respHeaders[k] = v;
  });
  res.writeHead(status, respHeaders);

  if (streaming && upstream.body) {
    // Tee: stream to the caller unchanged while accumulating (bounded) for usage.
    let acc = "";
    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        res.write(chunk);
        if (acc.length < MAX_ACC) acc += chunk.toString("utf8");
      }
    } finally {
      clearTimeout(timer);
      res.end();
    }
    const u = provider.streamUsage(parseSseData(acc));
    void emit(cfg, { client, project, targetName, status, usage: { ...u, model: u.model ?? reqJson?.model }, latencyMs: Date.now() - started, streamed: true });
    return;
  }

  // Non-streaming: buffer, echo, parse usage.
  const respBuf = Buffer.from(await upstream.arrayBuffer());
  clearTimeout(timer);
  res.end(respBuf);
  let respJson: any = null;
  try {
    respJson = JSON.parse(respBuf.toString("utf8"));
  } catch {
    /* non-JSON */
  }
  const u = respJson ? provider.usage(respJson) : {};
  void emit(cfg, { client, project, targetName, status, usage: { ...u, model: u.model ?? reqJson?.model }, latencyMs: Date.now() - started, streamed: false });
}

interface CaptureRecord {
  client: string;
  project?: string;
  targetName?: string;
  status: number;
  usage: Usage;
  latencyMs: number;
  streamed: boolean;
}

/** Build a trace + generation and POST to the resolved target, with one retry. */
async function emit(cfg: Config, rec: CaptureRecord): Promise<void> {
  const target = (rec.targetName && cfg.targets.find((t) => t.name === rec.targetName)) || safeActive(cfg);
  if (!target || !target.publicKey || !target.secretKey) {
    recordIngest(false, "no target/keys to emit to");
    return;
  }
  const now = new Date().toISOString();
  const traceId = randomUUID();
  const tags = [`service:${rec.client}`, ...(rec.project ? [`project:${rec.project}`] : [])];
  const isError = rec.status >= 400;

  const usage =
    rec.usage.inputTokens != null || rec.usage.outputTokens != null
      ? { input: rec.usage.inputTokens ?? 0, output: rec.usage.outputTokens ?? 0, unit: "TOKENS" as const }
      : undefined;

  const events: IngestionEvent[] = [
    { id: randomUUID(), type: "trace-create", timestamp: now, body: { id: traceId, name: `${rec.client}-gateway`, timestamp: now, tags } },
    {
      id: randomUUID(),
      type: "generation-create",
      timestamp: now,
      body: {
        id: randomUUID(),
        traceId,
        name: "llm-call",
        model: rec.usage.model,
        startTime: now,
        endTime: now,
        usage,
        level: isError ? (rec.status >= 500 ? "ERROR" : "WARNING") : "DEFAULT",
        statusMessage: isError ? `upstream HTTP ${rec.status}` : undefined,
        metadata: { latencyMs: rec.latencyMs, streamed: rec.streamed, httpStatus: rec.status, cacheReadTokens: rec.usage.cacheReadTokens, via: "fusion-gateway" },
      },
    },
  ];

  const client = new LangfuseClient(target);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await client.ingest(events);
      if (r.ok) return void recordIngest(true);
      if (attempt === 2) {
        // Auth/validation failures won't succeed on replay — signal, don't spool.
        if (r.status === 401 || r.status === 403) return void recordIngest(false, `ingest HTTP ${r.status}`);
        spool(target.name, events); // transient (5xx/unreachable) → durably buffer for replay
        return void recordIngest(false, `ingest HTTP ${r.status} — buffered for replay`);
      }
    } catch (err) {
      if (attempt === 2) {
        spool(target.name, events); // network/Langfuse-down → buffer for replay
        return void recordIngest(false, `ingest error: ${(err as Error).message} — buffered for replay`);
      }
    }
    await sleep(400);
  }
}

function safeActive(cfg: Config) {
  try {
    return activeTarget(cfg);
  } catch {
    return null;
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function forwardHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const key = k.toLowerCase();
    if (key === "host" || key === "content-length" || key === "x-fusion-token" || key.startsWith("x-fusion-")) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
  }
  return out;
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error(`request body exceeds ${max} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
