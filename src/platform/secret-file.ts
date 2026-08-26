import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Write KEY=value lines with mode 0600 so Docker --env-file can load secrets without putting them on argv. */
export function writeSecretEnvFile(path: string, vars: Record<string, string>): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}=${v.replace(/\n/g, "")}`)
    .join("\n") + "\n";
  writeFileSync(path, body, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}
