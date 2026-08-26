# Codex OTLP support for the telemetry bridge

Adds **OpenAI Codex CLI** ingestion to the `lainra/claude-code-telemetry` bridge,
alongside its existing Claude Code support. Both tools export to the same bridge
on port 4318 and land in the same local Langfuse.

## Why a patch (and not a fork)

The bridge lives in `third_party/claude-code-telemetry/`, which is **gitignored**
and re-cloned via `make otel-bridge-clone`. A raw edit there would be lost on
re-clone, so the changes are packaged here and re-applied idempotently.

## What it changes

The bridge is hard-wired to Claude's OTLP schema (it switches on `claude_code.*`
event/metric names). Codex uses a different schema, so this patch adds a
self-contained Codex path that never touches Claude logic:

1. **`src/codexHandler.js`** (new) — maps Codex telemetry to Langfuse traces.
2. **`src/server.js`** — routes the endpoint **root path** (`/`), where Codex POSTs
   OTLP, to the Codex dispatcher (Claude uses `/v1/logs` + `/v1/metrics`).
3. **`src/requestHandlers.js`** — a `service.name`-based guard so Codex logs are
   still handled if the endpoint is set to `/v1/logs`.

### Codex → Langfuse mapping

| Codex OTLP log event      | Langfuse                                            |
|---------------------------|-----------------------------------------------------|
| `codex.conversation_starts` | trace `codex-conversation` (tag `service:codex`)  |
| `codex.user_prompt`       | trace `input` (prompt + length)                     |
| `codex.api_request`       | `generation` observation (model, endpoint, status)  |
| `codex.sse_event`         | token usage on the generation (Langfuse computes cost when it knows the model) |
| `codex.tool_call` / `codex.tool_decision` | events                             |
| `codex.api_error` / sse error | WARNING/ERROR events                            |

Conversations are grouped by the `conversation.id` attribute. Codex vs Claude is
distinguished by resource `service.name` and the `service:codex` trace tag.

## Apply

```bash
make codex-bridge-patch     # idempotent; safe to re-run
make bridge-restart         # apply + rebuild image + recreate container
```

`make otel-bridge-clone` and `scripts/restart-bridge.sh` also apply it automatically.

## Enable Codex

Append `env/otel.codex.toml.example` to `~/.codex/config.toml`, then start Codex.

## Known limitations

- **Token/cost**: `codex exec` emits **no** OTLP metrics (openai/codex#12913). Token
  counts come from `codex.sse_event` logs, which only fire on a **completed** turn.
- **Per-directory attribution**: Codex's conversation events don't carry `cwd`, so —
  exactly like the Claude side — directory attribution isn't available from telemetry
  alone. `cwd` is mapped into trace metadata if a future Codex version emits it.
- The bridge parses **JSON** OTLP only, so Codex must use `protocol = "json"`.
