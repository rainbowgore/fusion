import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { codexConfigPath, dataDir, backupFileLayered } from "../platform/paths.js";

/** Source-enabling logic shared by the `enable` CLI command and the Govern API. */

export const CODEX_MARKER = "# fusion:otel-block";

/**
 * Remove ONLY Fusion's [otel] block from a codex config: from the marker line to
 * the end of the otel section — i.e. up to the next non-otel top-level table or
 * EOF. Preserves any user config the user added below the block (item 13).
 */
export function stripCodexBlock(txt: string): { changed: boolean; text: string } {
  const idx = txt.indexOf(CODEX_MARKER);
  if (idx < 0) return { changed: false, text: txt };
  // Include the blank line we inserted before the marker.
  let start = txt.lastIndexOf("\n", idx - 1);
  if (start < 0) start = 0;
  // From the marker, consume lines until a non-otel top-level table starts.
  const tail = txt.slice(idx);
  const lines = tail.split("\n");
  let consumed = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (i > 0 && l.startsWith("[") && !l.startsWith("[otel")) break;
    consumed += lines[i].length + 1; // include the newline
  }
  const end = idx + Math.min(consumed, tail.length);
  const before = txt.slice(0, start);
  const after = txt.slice(end);
  // Nothing after our block → restore the original bytes exactly (A4 byte-identical).
  if (!after.trim()) return { changed: true, text: before };
  // User config exists after our block → drop only our block, keep theirs.
  const out = before.replace(/\s+$/, "") + "\n\n" + after.replace(/^\s+/, "");
  return { changed: true, text: out.endsWith("\n") ? out : out + "\n" };
}

function normalizeOtlpUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const host = u.hostname === "localhost" ? "127.0.0.1" : u.hostname;
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    const path = u.pathname.replace(/\/$/, "");
    return `${u.protocol}//${host}:${port}${path}`;
  } catch {
    return url.trim().replace(/\/$/, "");
  }
}

/** First `endpoint = "..."` under `[otel.exporter.otlp-http]`, if present. */
export function codexOtlpEndpoint(toml: string): string | null {
  const header = toml.match(/(?:^|\n)\s*\[otel\.exporter\.otlp-http\][^\n]*/);
  if (!header || header.index == null) return null;
  const start = header.index + header[0].length;
  const rest = toml.slice(start);
  const next = rest.search(/\n\s*\[[^\]]+\]/);
  const section = next >= 0 ? rest.slice(0, next) : rest;
  const m = section.match(/^\s*endpoint\s*=\s*"([^"]+)"/m);
  return m ? m[1] : null;
}

export function enableCodex(endpoint: string, logPrompts: boolean): { ok: boolean; message: string } {
  const path = codexConfigPath();
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (existing.includes(CODEX_MARKER)) return { ok: true, message: `Codex already configured by Fusion in ${path} (no change).` };
  if (/^\s*\[otel\]/m.test(existing)) {
    const current = codexOtlpEndpoint(existing);
    if (current && normalizeOtlpUrl(current) === normalizeOtlpUrl(endpoint)) {
      return {
        ok: true,
        message: `Codex already exports OTLP to ${endpoint} (${path}). Fusion will treat it as enabled (no rewrite).`,
      };
    }
    return {
      ok: false,
      message:
        `Could not enable Codex: ${path} already has a non-Fusion [otel] block` +
        (current ? ` pointing at ${current}` : "") +
        `. Fusion needs ${endpoint}. Remove or update that [otel] block, then Enable again.`,
    };
  }

  const block =
    `\n${CODEX_MARKER} — OTLP export to Fusion's bridge (safe to remove)\n` +
    `[otel]\nenvironment = "production"\nlog_user_prompt = ${logPrompts ? "true" : "false"}\n\n` +
    `[otel.exporter.otlp-http]\nendpoint = "${endpoint}"\nprotocol = "json"\n`;
  const backup = backupFileLayered(path, "codex-config.toml");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, existing + block, "utf8");
  return { ok: true, message: `Appended [otel] to ${path}${backup ? ` (original preserved → ${backup})` : ""}. Restart Codex.` };
}

export function enableClaudeCode(endpoint: string, logPrompts: boolean): { ok: boolean; message: string; file: string } {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "claude-code.env.sh");
  const content =
    `# fusion:claude-code — source before launching Claude Code\n` +
    `export CLAUDE_CODE_ENABLE_TELEMETRY=1\nexport OTEL_LOGS_EXPORTER=otlp\nexport OTEL_METRICS_EXPORTER=otlp\n` +
    `export OTEL_EXPORTER_OTLP_PROTOCOL=http/json\nexport OTEL_EXPORTER_OTLP_METRICS_PROTOCOL=http/json\n` +
    `export OTEL_EXPORTER_OTLP_ENDPOINT="${endpoint}"\nexport OTEL_LOG_USER_PROMPTS=${logPrompts ? "1" : "0"}\n`;
  if (existsSync(file) && readFileSync(file, "utf8") === content) {
    return { ok: true, message: `Claude Code already configured in ${file} (no change).`, file };
  }
  writeFileSync(file, content, "utf8");
  return { ok: true, message: `Wrote ${file}. Enable with: source "${file}"`, file };
}

export { enableHermes } from "./hermes.js";
