/**
 * Codex Handler Module
 *
 * Ingests OpenAI Codex CLI OTLP/JSON telemetry into Langfuse, mirroring the
 * Claude Code path but for Codex's own schema.
 *
 * Differences from Claude Code that this module handles:
 *  - Codex POSTs OTLP to the endpoint ROOT path ("/"), not /v1/logs.
 *  - The event name lives in the `event.name` ATTRIBUTE (logRecord.body is null),
 *    not in logRecord.body.stringValue.
 *  - Conversations are grouped by the `conversation.id` attribute (Codex has no
 *    `session.id`).
 *  - Token usage arrives via `codex.sse_event` log records (Codex `exec` emits no
 *    OTLP metrics at all — see openai/codex#12913), so tokens are read from logs.
 *  - resource `service.name` is "codex_exec" / "codex" (used to detect Codex).
 *
 * Codex sessions are tracked independently of Claude's SessionHandler map so this
 * module never touches Claude logic.
 */

const pino = require('pino')
const { extractAttributesArray } = require('./sessionHandler')

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

// Codex conversations, keyed by conversation.id
const codexConversations = new Map()

function isCodexResource(resourceAttrs) {
  const name = (resourceAttrs && resourceAttrs['service.name']) || ''
  return typeof name === 'string' && name.toLowerCase().startsWith('codex')
}

function tsFromRecord(logRecord, attrs) {
  const iso = attrs && attrs['event.timestamp']
  if (iso) return iso
  const nano = logRecord.timeUnixNano || logRecord.observedTimeUnixNano
  return nano ? new Date(Number(nano) / 1e6).toISOString() : new Date().toISOString()
}

class CodexConversation {
  constructor(conversationId, resourceAttrs, langfuse) {
    this.conversationId = conversationId
    this.langfuse = langfuse
    this.resource = resourceAttrs || {}
    this.currentTrace = null
    this.currentGeneration = null
    this.promptCount = 0
    this.lastActivity = Date.now()
    this.service = {
      name: this.resource['service.name'] || 'codex',
      version: this.resource['service.version'] || this.resource['app.version'] || 'unknown',
      environment: this.resource['env'] || 'unknown',
      host: this.resource['host.name'],
    }
  }

  ensureTrace(attrs) {
    if (this.currentTrace) return this.currentTrace
    const model = attrs['model']
    this.currentTrace = this.langfuse.trace({
      name: 'codex-conversation',
      sessionId: this.conversationId,
      userId: process.env.USER_EMAIL || attrs['originator'] || this.service.host || 'codex',
      tags: [
        'service:codex',
        // project injected by Fusion via OTEL_RESOURCE_ATTRIBUTES (dir→project routing)
        (this.resource['project'] || this.resource['fusion.project'])
          ? `project:${this.resource['project'] || this.resource['fusion.project']}`
          : null,
        model ? `model:${model}` : null,
      ].filter(Boolean),
      metadata: {
        service: this.service,
        model,
        slug: attrs['slug'],
        reasoning_effort: attrs['reasoning_effort'],
        approval_policy: attrs['approval_policy'],
        sandbox_policy: attrs['sandbox_policy'],
        mcp_servers: attrs['mcp_servers'],
        provider_name: attrs['provider_name'],
        auth_mode: attrs['auth_mode'],
        cwd: attrs['cwd'] || null,
        conversationId: this.conversationId,
      },
    })
    return this.currentTrace
  }

  handle(eventName, attrs, tsISO) {
    this.lastActivity = Date.now()
    switch (eventName) {
      case 'codex.conversation_starts':
        this.ensureTrace(attrs)
        break

      case 'codex.user_prompt': {
        const trace = this.ensureTrace(attrs)
        this.promptCount++
        trace.update({
          input: {
            prompt: attrs['prompt'] || '[Prompt hidden — set otel.log_user_prompt=true]',
            length: attrs['prompt_length'] || 0,
          },
        })
        break
      }

      case 'codex.api_request': {
        const trace = this.ensureTrace(attrs)
        this.currentGeneration = this.langfuse.generation({
          name: 'api_request',
          traceId: trace.id,
          model: attrs['model'],
          startTime: new Date(tsISO),
          metadata: {
            endpoint: attrs['endpoint'],
            attempt: attrs['attempt'],
            status_code: attrs['http.response.status_code'],
            duration_ms: attrs['duration_ms'],
          },
        })
        break
      }

      case 'codex.sse_event': {
        // Carries token usage. Codex may emit multiple sse_events per turn with
        // running counts; take the latest non-zero values as the turn total.
        const input = num(attrs['input_token_count'])
        const output = num(attrs['output_token_count'])
        const cached = num(attrs['cached_token_count'])
        const reasoning = num(attrs['reasoning_token_count'])
        const errMsg = attrs['error.message']
        const trace = this.ensureTrace(attrs)

        if (input || output || cached || reasoning) {
          const usage = {
            input: input,
            output: output,
            total: input + output,
            unit: 'TOKENS',
          }
          if (this.currentGeneration) {
            this.currentGeneration.update({
              endTime: new Date(tsISO),
              usage, // Langfuse computes cost from model + usage when the model is known
              usageDetails: {
                input,
                output,
                cache_read_input_tokens: cached,
                reasoning_output_tokens: reasoning,
              },
              metadata: { event_kind: attrs['event.kind'], duration_ms: attrs['duration_ms'] },
            })
          } else {
            // No preceding api_request generation — attach usage to a standalone one
            this.langfuse.generation({
              name: 'sse_event',
              traceId: trace.id,
              model: attrs['model'],
              startTime: new Date(tsISO),
              endTime: new Date(tsISO),
              usage,
            })
          }
        }

        if (errMsg) {
          this.langfuse.event({
            name: 'codex.sse_error',
            traceId: trace.id,
            parentObservationId: this.currentGeneration?.id,
            level: 'WARNING',
            statusMessage: String(errMsg),
            metadata: { event_kind: attrs['event.kind'] },
          })
        }
        break
      }

      case 'codex.tool_call':
      case 'codex.tool_decision': {
        const trace = this.ensureTrace(attrs)
        this.langfuse.event({
          name: eventName,
          traceId: trace.id,
          parentObservationId: this.currentGeneration?.id,
          startTime: new Date(tsISO),
          metadata: attrs,
        })
        break
      }

      case 'codex.api_error': {
        const trace = this.ensureTrace(attrs)
        this.langfuse.event({
          name: 'codex.api_error',
          traceId: trace.id,
          parentObservationId: this.currentGeneration?.id,
          level: 'ERROR',
          statusMessage: String(attrs['error.message'] || attrs['error'] || 'api_error'),
          metadata: attrs,
        })
        break
      }

      default:
        // Operational events (startup_phase, websocket_connect/request, etc.)
        logger.debug({ eventName, conversationId: this.conversationId }, 'Codex event (unmapped)')
    }
  }
}

function num(v) {
  const n = typeof v === 'number' ? v : parseInt(v || '0', 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Ingest a parsed OTLP logs payload from Codex.
 */
function processCodexLogs(logs, langfuse) {
  if (!logs || !logs.resourceLogs) return 0
  let handled = 0
  for (const resourceLog of logs.resourceLogs) {
    const resourceAttrs = extractAttributesArray(resourceLog.resource?.attributes)
    for (const scopeLog of resourceLog.scopeLogs || []) {
      for (const logRecord of scopeLog.logRecords || []) {
        const attrs = extractAttributesArray(logRecord.attributes)
        const eventName = attrs['event.name'] || logRecord.body?.stringValue
        const conversationId = attrs['conversation.id']
        if (!eventName || !conversationId) {
          logger.debug({ eventName, conversationId }, 'Codex log without event/conversation id')
          continue
        }
        if (!codexConversations.has(conversationId)) {
          codexConversations.set(
            conversationId,
            new CodexConversation(conversationId, resourceAttrs, langfuse),
          )
        }
        const conv = codexConversations.get(conversationId)
        conv.handle(eventName, attrs, tsFromRecord(logRecord, attrs))
        handled++
      }
    }
  }
  return handled
}

/**
 * Content-based OTLP dispatcher for Codex (Codex POSTs to the root path).
 * Returns true if the payload was recognized/handled as Codex telemetry.
 */
function handleCodexOtlp(data, res, langfuse) {
  let payload
  try {
    payload = JSON.parse(data.toString())
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid JSON' }))
    return true
  }

  if (payload.resourceLogs) {
    const n = processCodexLogs(payload, langfuse)
    logger.info({ records: n }, 'Codex logs ingested')
  } else if (payload.resourceMetrics) {
    // Codex interactive mode emits codex.* metrics; token usage is already
    // captured from codex.sse_event logs, so metrics are acknowledged only.
    logger.debug({ size: data.length }, 'Codex metrics received (ack only)')
  } else if (payload.resourceSpans) {
    logger.debug({ size: data.length }, 'Codex spans received (ack only)')
  } else {
    res.writeHead(404)
    res.end('Not found')
    return true
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ partialSuccess: {} }))
  return true
}

module.exports = { handleCodexOtlp, processCodexLogs, isCodexResource, codexConversations }
