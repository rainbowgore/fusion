import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "../platform/paths.js";
import { loadConfig } from "../config/load.js";
import { LangfuseClient, type IngestionEvent } from "../langfuse/client.js";
import { recordIngest } from "./signals.js";

/**
 * Durability buffer (Decision 4 = buffer, not accept-loss). When an ingestion
 * emit fails (Langfuse down/unreachable), the batch is spooled to disk; a drainer
 * replays spooled batches when Langfuse recovers. Bounded so it can't grow without
 * limit. Scoped to the gateway's emissions (the part the daemon owns).
 */
interface SpoolEntry {
  targetName?: string;
  events: IngestionEvent[];
  firstFailedAt: number;
}

const MAX_SPOOL_FILES = 5000;

function spoolDir(): string {
  return join(dataDir(), "spool");
}

/** Persist a failed batch for later replay. Returns the spool path (or null if capped). */
export function spool(targetName: string | undefined, events: IngestionEvent[]): string | null {
  const dir = spoolDir();
  mkdirSync(dir, { recursive: true });
  try {
    if (readdirSync(dir).length >= MAX_SPOOL_FILES) {
      recordIngest(false, `spool full (${MAX_SPOOL_FILES} files) — dropping batch`);
      return null;
    }
  } catch {
    /* ignore */
  }
  const path = join(dir, `${Date.now()}-${randomUUID()}.json`);
  const entry: SpoolEntry = { targetName, events, firstFailedAt: Date.now() };
  writeFileSync(path, JSON.stringify(entry), "utf8");
  return path;
}

export function spoolDepth(): number {
  try {
    return existsSync(spoolDir()) ? readdirSync(spoolDir()).filter((f) => f.endsWith(".json")).length : 0;
  } catch {
    return 0;
  }
}

/** Try to replay spooled batches. Returns {sent, remaining}. */
export async function drain(max = 200): Promise<{ sent: number; remaining: number }> {
  const dir = spoolDir();
  if (!existsSync(dir)) return { sent: 0, remaining: 0 };
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return { sent: 0, remaining: 0 };
  }
  let cfg;
  try {
    cfg = loadConfig();
  } catch {
    return { sent: 0, remaining: files.length };
  }

  let sent = 0;
  for (const f of files.slice(0, max)) {
    const p = join(dir, f);
    let entry: SpoolEntry;
    try {
      entry = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      rmSync(p, { force: true }); // corrupt spool file — drop it
      continue;
    }
    const target =
      (entry.targetName && cfg.targets.find((t) => t.name === entry.targetName)) ||
      cfg.targets.find((t) => t.name === cfg.activeTarget);
    if (!target || !target.publicKey || !target.secretKey) continue;
    try {
      const r = await new LangfuseClient(target).ingest(entry.events);
      if (r.ok) {
        rmSync(p, { force: true });
        sent++;
        recordIngest(true);
      }
      // non-ok → leave the file for the next tick
    } catch {
      // still down → stop this pass; try again next tick
      break;
    }
  }
  return { sent, remaining: spoolDepth() };
}

let timer: NodeJS.Timeout | null = null;

/** Start a periodic drainer inside the daemon. */
export function startDrainer(intervalMs = 15_000): void {
  if (timer) return;
  timer = setInterval(() => {
    void drain().catch(() => {});
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopDrainer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
