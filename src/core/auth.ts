import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { dataDir } from "../platform/paths.js";

/**
 * Trust model:
 * - Control UI: same-origin + HttpOnly session cookie (not embedded in HTML).
 * - CLI / MCP: same local user; they call govern functions in-process, not /control.
 * - Gateway path /k/<token>/ uses a separate gateway token so Hermes URLs are not the session cookie.
 */
export const SESSION_COOKIE = "fusion_session";

function tokenFile(name: string): string {
  return join(dataDir(), name);
}

function loadOrCreate(name: string): string {
  const p = tokenFile(name);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  mkdirSync(dataDir(), { recursive: true });
  const tok = randomBytes(24).toString("hex");
  writeFileSync(p, tok, { encoding: "utf8", mode: 0o600 });
  return tok;
}

export function getOrCreateToken(): string {
  return loadOrCreate("daemon.token");
}

export function getOrCreateGatewayToken(): string {
  return loadOrCreate("gateway.token");
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`;
}

export function tokenFromCookie(req: IncomingMessage): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of String(raw).split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

/** Same-origin guard: reject a request whose Origin isn't our own control host. */
export function originAllowed(req: IncomingMessage, daemonPort: number): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && Number(u.port) === daemonPort;
  } catch {
    return false;
  }
}

export function tokenValid(req: IncomingMessage, expected: string): boolean {
  const got = req.headers["x-fusion-token"];
  const val = Array.isArray(got) ? got[0] : got;
  if (typeof val === "string" && constantTimeEqual(val, expected)) return true;
  const cookie = tokenFromCookie(req);
  return typeof cookie === "string" && constantTimeEqual(cookie, expected);
}

export function gatewayCredentialValid(got: string): boolean {
  return constantTimeEqual(got, getOrCreateGatewayToken()) || constantTimeEqual(got, getOrCreateToken());
}

/** Length-independent constant-time string compare. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(bb, bb);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
