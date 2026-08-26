import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROVIDERS: Record<string, string> = {
  "claude-code": "claude-code.png",
  codex: "codex.png",
  cursor: "cursor.png",
  hermes: "hermes.png",
};

function providerDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "providers");
}

/** Data-URI map so coverage + govern always show the local brand marks. */
export function providerLogoDataUris(): Record<string, string> {
  const dir = providerDir();
  const out: Record<string, string> = {};
  for (const [client, file] of Object.entries(PROVIDERS)) {
    out[client] = `data:image/png;base64,${readFileSync(join(dir, file)).toString("base64")}`;
  }
  return out;
}

export function logoImg(src: string, px = 36): string {
  return `<img class="tool-logo" src="${src}" alt="" width="${px}" height="${px}">`;
}
