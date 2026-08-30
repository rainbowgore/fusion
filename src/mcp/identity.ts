import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FUSION_MCP_WEBSITE = "https://github.com/rainbowgore/fusion";
export const FUSION_MCP_TITLE = "Fusion";
export const FUSION_MCP_DESCRIPTION = "Govern capture and routing into Langfuse from this machine.";

export type FusionMcpIcon = {
  src: string;
  mimeType: string;
  sizes: string[];
  theme?: "light" | "dark";
};

function assetsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets");
}

function dataUri(file: string, mimeType: string): string | null {
  const path = join(assetsDir(), file);
  if (!existsSync(path)) return null;
  return `data:${mimeType};base64,${readFileSync(path).toString("base64")}`;
}

/** Spec icons for initialize + tools. Data URIs first so Cursor/Hermes work offline. */
export function fusionMcpIcons(): FusionMcpIcon[] {
  const icons: FusionMcpIcon[] = [];
  const dark = dataUri("mcp-icon.svg", "image/svg+xml");
  const light = dataUri("mcp-icon-light.svg", "image/svg+xml");
  const png = dataUri("mcp-logo.png", "image/png");
  if (dark) icons.push({ src: dark, mimeType: "image/svg+xml", sizes: ["any"], theme: "dark" });
  if (light) icons.push({ src: light, mimeType: "image/svg+xml", sizes: ["any"], theme: "light" });
  if (png) icons.push({ src: png, mimeType: "image/png", sizes: ["512x512"] });
  icons.push({
    src: "https://raw.githubusercontent.com/rainbowgore/fusion/main/assets/mcp-icon.svg",
    mimeType: "image/svg+xml",
    sizes: ["any"],
    theme: "dark",
  });
  return icons;
}

export function fusionMcpServerInfo(): {
  name: string;
  title: string;
  version: string;
  description: string;
  websiteUrl: string;
  icons: FusionMcpIcon[];
} {
  return {
    name: "fusion",
    title: FUSION_MCP_TITLE,
    version: "0.0.0",
    description: FUSION_MCP_DESCRIPTION,
    websiteUrl: FUSION_MCP_WEBSITE,
    icons: fusionMcpIcons(),
  };
}
