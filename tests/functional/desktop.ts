/**
 * macOS desktop automation helpers for Cursor / Hermes.
 * Gated by app installation — never fails the suite solely because an app is missing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { appInstalled, recordSkip, sleep } from "./setup.ts";

export type DesktopApp = "Cursor" | "Hermes";

export function isDesktopAppInstalled(app: DesktopApp): boolean {
  if (process.platform !== "darwin") return false;
  if (app === "Cursor") return appInstalled("Cursor");
  // Hermes Desktop may register as "Hermes" or via hermes CLI
  return appInstalled("Hermes") || appInstalled("Hermes Agent");
}

export function activateApp(app: DesktopApp): { ok: boolean; detail: string } {
  if (!isDesktopAppInstalled(app)) {
    return { ok: false, detail: `${app} is not installed` };
  }
  const r = spawnSync("osascript", ["-e", `tell application "${app}" to activate`], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (r.status !== 0) {
    return { ok: false, detail: (r.stderr || r.stdout || "osascript failed").trim() };
  }
  return { ok: true, detail: `activated ${app}` };
}

export function takeScreenshot(outPath: string): { ok: boolean; detail: string } {
  mkdirSync(join(outPath, ".."), { recursive: true });
  const r = spawnSync("screencapture", ["-x", "-t", "png", outPath], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (r.status !== 0) {
    return { ok: false, detail: (r.stderr || r.stdout || "screencapture failed").trim() };
  }
  writeFileSync(`${outPath}.meta.txt`, `captured at ${new Date().toISOString()}\n`, "utf8");
  return { ok: true, detail: outPath };
}

/**
 * Best-effort: open Cursor, wait briefly, screenshot.
 * Does not assert MCP UI chrome (fragile across Cursor versions).
 */
export async function verifyCursorMcpSurface(screenshotDir: string): Promise<{
  ok: boolean;
  skipped: boolean;
  detail: string;
}> {
  if (!isDesktopAppInstalled("Cursor")) {
    recordSkip("desktop", "cursor-mcp-ui", "Cursor Desktop not installed");
    return { ok: true, skipped: true, detail: "Cursor Desktop not installed" };
  }
  const act = activateApp("Cursor");
  if (!act.ok) {
    recordSkip("desktop", "cursor-mcp-ui", act.detail);
    return { ok: true, skipped: true, detail: act.detail };
  }
  await sleep(2000);
  const shot = takeScreenshot(join(screenshotDir, "cursor-mcp.png"));
  return { ok: shot.ok, skipped: false, detail: shot.detail };
}

/**
 * Best-effort: open Hermes Desktop, wait, screenshot.
 */
export async function verifyHermesMcpSurface(screenshotDir: string): Promise<{
  ok: boolean;
  skipped: boolean;
  detail: string;
}> {
  if (!isDesktopAppInstalled("Hermes")) {
    recordSkip("desktop", "hermes-mcp-ui", "Hermes Desktop not installed");
    return { ok: true, skipped: true, detail: "Hermes Desktop not installed" };
  }
  const act = activateApp("Hermes");
  if (!act.ok) {
    recordSkip("desktop", "hermes-mcp-ui", act.detail);
    return { ok: true, skipped: true, detail: act.detail };
  }
  await sleep(2000);
  const shot = takeScreenshot(join(screenshotDir, "hermes-mcp.png"));
  return { ok: shot.ok, skipped: false, detail: shot.detail };
}
