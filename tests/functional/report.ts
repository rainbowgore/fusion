/**
 * Action coverage matrix for the functional suite.
 * Surfaces record exercised / skipped actions; emitCoverageReport prints the matrix.
 */

export type Surface =
  | "cli"
  | "enable"
  | "connect"
  | "mcp"
  | "ui"
  | "gateway"
  | "prices"
  | "desktop";

type Entry = { action: string; surface: Surface; status: "ok" | "skipped"; reason?: string };

const entries: Entry[] = [];

export function recordAction(surface: Surface, action: string): void {
  entries.push({ surface, action, status: "ok" });
}

export function recordSkip(surface: Surface, action: string, reason: string): void {
  entries.push({ surface, action, status: "skipped", reason });
}

export function getCoverageEntries(): readonly Entry[] {
  return entries;
}

export function resetCoverage(): void {
  entries.length = 0;
}

export function emitCoverageReport(): string {
  const lines = ["", "=== Fusion functional coverage matrix ==="];
  const bySurface = new Map<Surface, Entry[]>();
  for (const e of entries) {
    const list = bySurface.get(e.surface) ?? [];
    list.push(e);
    bySurface.set(e.surface, list);
  }
  for (const surface of ["cli", "enable", "connect", "mcp", "ui", "gateway", "prices", "desktop"] as Surface[]) {
    const list = bySurface.get(surface) ?? [];
    lines.push(`\n[${surface}]`);
    if (list.length === 0) {
      lines.push("  (no actions recorded)");
      continue;
    }
    for (const e of list) {
      if (e.status === "ok") lines.push(`  OK   ${e.action}`);
      else lines.push(`  SKIP ${e.action} — ${e.reason ?? ""}`);
    }
  }
  const ok = entries.filter((e) => e.status === "ok").length;
  const skipped = entries.filter((e) => e.status === "skipped").length;
  lines.push(`\nTotal: ${ok} exercised, ${skipped} skipped`);
  lines.push("=========================================\n");
  const text = lines.join("\n");
  console.log(text);
  return text;
}
