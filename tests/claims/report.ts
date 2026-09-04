import { CLAIMS } from "./catalog.ts";

export type ClaimResult = { id: string; kind: "function" | "value"; ok: boolean; detail: string };

const results: ClaimResult[] = [];
let emitted = false;

export function recordClaim(r: ClaimResult): void {
  results.push(r);
}

process.on("beforeExit", () => {
  if (!emitted && results.length) emitClaimsReport();
});

export function emitClaimsReport(): string {
  if (emitted) return "";
  emitted = true;
  const lines = ["", "=== Fusion claims (function + value) ==="];
  const ids = CLAIMS.map((c) => c.id);
  for (const id of ids) {
    const fn = results.find((r) => r.id === id && r.kind === "function");
    const val = results.find((r) => r.id === id && r.kind === "value");
    const mark = (r?: ClaimResult) => (r ? (r.ok ? "OK" : "FAIL") : "—");
    lines.push(`${id}`);
    lines.push(`  function ${mark(fn)}${fn ? ` — ${fn.detail}` : ""}`);
    lines.push(`  value    ${mark(val)}${val ? ` — ${val.detail}` : ""}`);
  }
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  lines.push(`\nTotal: ${ok} passed, ${fail} failed`);
  lines.push("=======================================\n");
  const text = lines.join("\n");
  console.log(text);
  return text;
}
