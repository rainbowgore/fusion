import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./paths.js";

export type LogLevel = "info" | "warn" | "error";

function line(level: LogLevel, msg: string, extra?: Record<string, unknown>): string {
  const rec: Record<string, unknown> = { ts: new Date().toISOString(), level, msg };
  if (extra) Object.assign(rec, extra);
  return JSON.stringify(rec) + "\n";
}

/** Append a structured line to fusion.log. Never throws. */
export function log(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  try {
    mkdirSync(dataDir(), { recursive: true });
    appendFileSync(join(dataDir(), "fusion.log"), line(level, msg, extra), "utf8");
  } catch {
    /* logging must not break the control plane */
  }
}

export const info = (msg: string, extra?: Record<string, unknown>) => log("info", msg, extra);
export const warn = (msg: string, extra?: Record<string, unknown>) => log("warn", msg, extra);
export const error = (msg: string, extra?: Record<string, unknown>) => log("error", msg, extra);
