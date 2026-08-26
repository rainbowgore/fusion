/**
 * In-memory ingestion signal for the running daemon: tracks the last emit result
 * so `doctor`/coverage can surface silent-drop problems instead of swallowing them.
 * (Resets on daemon restart — it's a liveness signal, not persistent state.)
 */
let okCount = 0;
let failCount = 0;
let lastError: string | null = null;
let lastAt = 0;

export function recordIngest(ok: boolean, message?: string): void {
  lastAt = Date.now();
  if (ok) {
    okCount++;
    lastError = null;
  } else {
    failCount++;
    lastError = message ?? "unknown ingest failure";
    // Also make it visible in the daemon log.
    console.error(`[ingest] ${lastError}`);
  }
}

export function ingestSignal(): { ok: number; fail: number; lastError: string | null; lastAt: number } {
  return { ok: okCount, fail: failCount, lastError, lastAt };
}
