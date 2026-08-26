/** Parses a `--since` window like "7d", "24h", "30d" into an ISO fromTimestamp. */
export function parseSince(since: string, now = new Date()): { fromTimestamp: string; label: string } {
  const m = /^(\d+)\s*([dhw])$/.exec(since.trim());
  if (!m) throw new Error(`Invalid --since "${since}". Use e.g. 7d, 24h, 2w.`);
  const n = Number(m[1]);
  const unit = m[2];
  const ms = unit === "h" ? n * 3_600_000 : unit === "w" ? n * 7 * 86_400_000 : n * 86_400_000;
  const from = new Date(now.getTime() - ms);
  return { fromTimestamp: from.toISOString(), label: since.trim() };
}
