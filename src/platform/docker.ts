import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export interface DockerStatus {
  installed: boolean;
  daemonRunning: boolean;
  composeAvailable: boolean;
  version?: string;
  detail?: string;
}

/** CLI + daemon + Compose v2 — required only for a local Langfuse (docker-local sink). */
export function dockerRequiredForSink(sink: string | undefined): boolean {
  return sink === "docker-local";
}

export function dockerReady(d: DockerStatus): boolean {
  return d.installed && d.daemonRunning && d.composeAvailable;
}

export function dockerNotReadyReason(d: DockerStatus): string {
  if (!d.installed) return d.detail ?? "docker CLI not found on PATH";
  if (!d.daemonRunning) return d.detail ?? "docker daemon not reachable (is Docker Desktop running?)";
  if (!d.composeAvailable) return "docker compose is not available (Compose v2 is required)";
  return "";
}

/** Detects Docker availability without throwing. */
export async function detectDocker(): Promise<DockerStatus> {
  let installed = false;
  let version: string | undefined;
  try {
    const { stdout } = await pexec("docker", ["--version"]);
    installed = true;
    version = stdout.trim();
  } catch {
    return { installed: false, daemonRunning: false, composeAvailable: false, detail: "docker CLI not found on PATH" };
  }

  let daemonRunning = false;
  let detail: string | undefined;
  try {
    await pexec("docker", ["info", "--format", "{{.ServerVersion}}"]);
    daemonRunning = true;
  } catch (err) {
    detail = "docker daemon not reachable (is Docker Desktop running?)";
  }

  let composeAvailable = false;
  try {
    await pexec("docker", ["compose", "version"]);
    composeAvailable = true;
  } catch {
    composeAvailable = false;
  }

  return { installed, daemonRunning, composeAvailable, version, detail };
}
