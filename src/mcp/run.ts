#!/usr/bin/env node
/** Fusion MCP server entrypoint (stdio). Launched by `fusion mcp` and by clients. */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "./server.js";

async function main() {
  const server = buildMcpServer();
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
