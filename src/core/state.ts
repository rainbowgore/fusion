import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../platform/paths.js";
import { HEARTBEAT_STALE_MS } from "../platform/limits.js";

function pidPath(): string {
  return join(dataDir(), "daemon.pid");
}

function heartbeatPath(): string {
  return join(dataDir(), "daemon.heartbeat");
}

/** Exclusive pidfile. Returns false if another live daemon owns it. */
export function acquirePid(pid: number): boolean {
  mkdirSync(dataDir(), { recursive: true });
  const p = pidPath();
  try {
    const fd = openSync(p, "wx");
    try {
      writeFileSync(fd, String(pid), "utf8");
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    const existing = readPid();
    if (existing != null && isAlive(existing)) return false;
    try {
      rmSync(p);
    } catch {
      /* race */
    }
    try {
      const fd = openSync(p, "wx");
      try {
        writeFileSync(fd, String(pid), "utf8");
      } finally {
        closeSync(fd);
      }
      return true;
    } catch {
      return false;
    }
  }
}

export function writePid(pid: number): void {
  if (!acquirePid(pid)) {
    const existing = readPid();
    if (existing != null && existing !== pid && isAlive(existing)) {
      throw new Error(`another Fusion daemon already holds ${pidPath()} (pid ${existing})`);
    }
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(pidPath(), String(pid), "utf8");
  }
}

export function readPid(): number | null {
  const p = pidPath();
  if (!existsSync(p)) return null;
  const n = Number(readFileSync(p, "utf8").trim());
  return Number.isFinite(n) ? n : null;
}

export function clearPid(): void {
  const p = pidPath();
  if (existsSync(p)) rmSync(p);
  const h = heartbeatPath();
  if (existsSync(h)) rmSync(h);
}

export function writeHeartbeat(): void {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(heartbeatPath(), String(Date.now()), "utf8");
}

export function heartbeatAgeMs(): number | null {
  const p = heartbeatPath();
  if (!existsSync(p)) return null;
  const n = Number(readFileSync(p, "utf8").trim());
  if (!Number.isFinite(n)) return null;
  return Date.now() - n;
}

export function daemonLooksHung(): boolean {
  if (!daemonRunning()) return false;
  const age = heartbeatAgeMs();
  return age != null && age > HEARTBEAT_STALE_MS;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function daemonRunning(): boolean {
  const pid = readPid();
  return pid != null && isAlive(pid);
}
