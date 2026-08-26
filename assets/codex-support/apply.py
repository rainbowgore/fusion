#!/usr/bin/env python3
"""
Idempotently apply Codex OTLP support to the lainra/claude-code-telemetry bridge
clone under third_party/. Safe to run repeatedly; re-run after `make otel-bridge-clone`.

What it does:
  1. Copies codexHandler.js into the bridge's src/.
  2. Adds the codexHandler require to server.js.
  3. Routes the endpoint root path ("/") — where Codex POSTs OTLP — to handleCodexOtlp.
  4. Adds a service.name-based Codex delegation guard to handleLogs (covers the
     case where the endpoint is set to /v1/logs instead of the root).

See patches/codex-support/README.md for background.
"""
import os
import shutil
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Fusion sets BRIDGE_DIR to its own vendored bridge clone; fall back to the
# prototype's third_party/ layout when run standalone.
BRIDGE = os.environ.get("BRIDGE_DIR") or os.path.join(REPO, "third_party", "claude-code-telemetry")
SRC = os.path.join(BRIDGE, "src")
HERE = os.path.dirname(os.path.abspath(__file__))


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def patch(path, marker, find, replace, desc, count=1):
    with open(path) as f:
        content = f.read()
    if marker in content:
        print(f"  = already applied: {desc}")
        return
    if find not in content:
        fail(f"anchor not found for '{desc}' in {os.path.basename(path)} "
             f"(bridge version may have changed — patch manually)")
    with open(path, "w") as f:
        f.write(content.replace(find, replace, count))
    print(f"  + applied: {desc}")


def main():
    if not os.path.isdir(SRC):
        fail(f"bridge src not found at {SRC} — run `make otel-bridge-clone` first")

    # 1. Copy the handler module.
    shutil.copy2(os.path.join(HERE, "codexHandler.js"), os.path.join(SRC, "codexHandler.js"))
    print("  + copied src/codexHandler.js")

    # 2. Require in server.js.
    patch(
        os.path.join(SRC, "server.js"),
        marker="require('./codexHandler')",
        find="const { handleTraces, handleMetrics, handleLogs, handleHealthCheck } = require('./requestHandlers')",
        replace=("const { handleTraces, handleMetrics, handleLogs, handleHealthCheck } = require('./requestHandlers')\n"
                 "const { handleCodexOtlp } = require('./codexHandler')"),
        desc="server.js require",
    )

    # 3. Root-path routing in server.js.
    patch(
        os.path.join(SRC, "server.js"),
        marker="handleCodexOtlp(body, res, langfuse)",
        find=("        } else {\n"
              "          res.writeHead(404)\n"
              "          res.end('Not found')\n"
              "        }"),
        replace=("        } else {\n"
                 "          // Codex CLI POSTs OTLP to the endpoint root path; dispatch by payload content.\n"
                 "          handleCodexOtlp(body, res, langfuse)\n"
                 "        }"),
        desc="server.js root-path route",
    )

    # 4. service.name guard in requestHandlers.handleLogs.
    patch(
        os.path.join(SRC, "requestHandlers.js"),
        marker="Codex logs ingested via /v1/logs",
        find=("    const logs = JSON.parse(data.toString())\n"
              "    logger.debug({ size: data.length }, 'Received logs')\n"),
        replace=("    const logs = JSON.parse(data.toString())\n"
                 "    logger.debug({ size: data.length }, 'Received logs')\n\n"
                 "    // Codex telemetry may arrive here if the endpoint is set to /v1/logs.\n"
                 "    // Detect it by resource service.name and hand off to the Codex handler.\n"
                 "    const firstResourceAttrs = extractAttributesArray(logs?.resourceLogs?.[0]?.resource?.attributes)\n"
                 "    const svcName = (firstResourceAttrs['service.name'] || '').toLowerCase()\n"
                 "    if (svcName.startsWith('codex')) {\n"
                 "      const { processCodexLogs } = require('./codexHandler')\n"
                 "      const n = processCodexLogs(logs, langfuse)\n"
                 "      logger.info({ records: n }, 'Codex logs ingested via /v1/logs')\n"
                 "      res.writeHead(200, { 'Content-Type': 'application/json' })\n"
                 "      res.end(JSON.stringify({ partialSuccess: {} }))\n"
                 "      return\n"
                 "    }\n"),
        desc="requestHandlers.js /v1/logs guard",
    )

    # 5. Tag the primary conversation trace with service:claude-code so the
    #    source is filterable in Langfuse (upstream no longer sets any tags).
    patch(
        os.path.join(SRC, "sessionHandler.js"),
        marker="fusion:cc-primary",
        find=("      userId: attrs['user.email'] || attrs['user.id'] || this.metadata.userId,\n"
              "      input: {\n"
              "        prompt: attrs.prompt || '[Prompt hidden]',"),
        replace=("      userId: attrs['user.email'] || attrs['user.id'] || this.metadata.userId,\n"
                 "      tags: ['service:claude-code', ...(this.metadata.service.project ? ['project:' + this.metadata.service.project] : [])], // fusion:cc-primary\n"
                 "      input: {\n"
                 "        prompt: attrs.prompt || '[Prompt hidden]',"),
        desc="sessionHandler.js service:claude-code + project tag (primary trace)",
    )

    # 6. Same tag on the api_request-first fallback trace (no user_prompt case).
    patch(
        os.path.join(SRC, "sessionHandler.js"),
        marker="fusion:cc-fallback",
        find=("        userId: attrs['user.email'] || this.userEmail || this.metadata.userId,\n"
              "        input: {\n"
              "          prompt: '[No user prompt captured - OTEL_LOG_USER_PROMPTS may be disabled]',"),
        replace=("        userId: attrs['user.email'] || this.userEmail || this.metadata.userId,\n"
                 "        tags: ['service:claude-code', ...(this.metadata.service.project ? ['project:' + this.metadata.service.project] : [])], // fusion:cc-fallback\n"
                 "        input: {\n"
                 "          prompt: '[No user prompt captured - OTEL_LOG_USER_PROMPTS may be disabled]',"),
        desc="sessionHandler.js service:claude-code + project tag (fallback trace)",
    )

    # 7. Capture the injected `project` resource attribute (from Fusion's
    #    OTEL_RESOURCE_ATTRIBUTES) so the trace tags above can emit project:<value>.
    patch(
        os.path.join(SRC, "sessionHandler.js"),
        marker="project: attrs['project']",
        find="      terminalType: attrs['terminal.type'],\n    }\n  }",
        replace=("      terminalType: attrs['terminal.type'],\n"
                 "      project: attrs['project'] || attrs['fusion.project'], // fusion:project-attr\n"
                 "    }\n  }"),
        desc="sessionHandler.js capture injected project resource attribute",
    )

    print("Codex support applied. Rebuild the bridge image to take effect "
          "(scripts/restart-bridge.sh).")


if __name__ == "__main__":
    main()
