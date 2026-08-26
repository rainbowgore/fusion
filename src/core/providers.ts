/**
 * Provider routing + usage extraction for the gateway. A client points its base
 * URL at `http://localhost:<gateway>/gw/<provider>` and the gateway forwards to
 * the real upstream, extracting token usage from both non-streaming JSON and
 * streamed SSE responses (provider-specific shapes).
 */
export interface Usage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

export interface ProviderSpec {
  slug: string;
  upstream: string;
  /** Usage from a parsed non-streaming JSON body (chat completions OR responses API). */
  usage: (body: any) => Usage;
  /** Usage from the parsed `data:` objects of an SSE stream. */
  streamUsage: (events: any[]) => Usage;
  /** If the client streams, add whatever makes the upstream emit usage in-stream. */
  ensureStreamUsage?: (reqBody: any) => any;
}

export const PROVIDERS: Record<string, ProviderSpec> = {
  openai: {
    slug: "openai",
    upstream: "https://api.openai.com",
    // Chat Completions: prompt/completion_tokens. Responses API: input/output_tokens.
    usage: (b) => ({
      model: b?.model,
      inputTokens: b?.usage?.prompt_tokens ?? b?.usage?.input_tokens,
      outputTokens: b?.usage?.completion_tokens ?? b?.usage?.output_tokens,
      cacheReadTokens: b?.usage?.prompt_tokens_details?.cached_tokens ?? b?.usage?.input_tokens_details?.cached_tokens,
    }),
    streamUsage: (events) => {
      let u: Usage = {};
      for (const e of events) {
        if (e?.model && !u.model) u.model = e.model;
        // Chat Completions with stream_options.include_usage → a final chunk carries usage.
        if (e?.usage) {
          u.inputTokens = e.usage.prompt_tokens ?? e.usage.input_tokens ?? u.inputTokens;
          u.outputTokens = e.usage.completion_tokens ?? e.usage.output_tokens ?? u.outputTokens;
          u.cacheReadTokens = e.usage.prompt_tokens_details?.cached_tokens ?? u.cacheReadTokens;
        }
        // Responses API streaming → response.completed carries response.usage.
        if (e?.response?.usage) {
          u.inputTokens = e.response.usage.input_tokens ?? u.inputTokens;
          u.outputTokens = e.response.usage.output_tokens ?? u.outputTokens;
          if (e.response.model) u.model = e.response.model;
        }
      }
      return u;
    },
    // Ask OpenAI to include a usage chunk in the stream (Chat Completions).
    ensureStreamUsage: (req) => {
      if (req && typeof req === "object" && req.stream === true && !("stream_options" in req)) {
        return { ...req, stream_options: { include_usage: true } };
      }
      return req;
    },
  },
  anthropic: {
    slug: "anthropic",
    upstream: "https://api.anthropic.com",
    usage: (b) => ({
      model: b?.model,
      inputTokens: b?.usage?.input_tokens,
      outputTokens: b?.usage?.output_tokens,
      cacheReadTokens: b?.usage?.cache_read_input_tokens,
    }),
    streamUsage: (events) => {
      const u: Usage = {};
      for (const e of events) {
        if (e?.type === "message_start" && e.message) {
          u.model = e.message.model ?? u.model;
          u.inputTokens = e.message.usage?.input_tokens ?? u.inputTokens;
          u.cacheReadTokens = e.message.usage?.cache_read_input_tokens ?? u.cacheReadTokens;
        }
        // message_delta carries the running output_tokens (last one wins).
        if (e?.type === "message_delta" && e.usage?.output_tokens != null) {
          u.outputTokens = e.usage.output_tokens;
        }
      }
      return u;
    },
  },
};

export function resolveProvider(
  slug: string,
  overrideUpstream?: string,
  opts?: { hermesShape?: "openai" | "anthropic" },
): ProviderSpec | null {
  let base = PROVIDERS[slug];
  if (slug === "hermes") {
    const proto = opts?.hermesShape === "anthropic" ? PROVIDERS.anthropic : PROVIDERS.openai;
    base = { ...proto, slug: "hermes" };
  }
  if (!base) return null;
  if (!overrideUpstream) return base;
  try {
    const u = new URL(overrideUpstream);
    if (u.protocol !== "http:" && u.protocol !== "https:") return base;
    return { ...base, upstream: overrideUpstream.replace(/\/+$/, "") };
  } catch {
    return base;
  }
}

/** Parse SSE text into the array of JSON `data:` objects (ignoring [DONE]). */
export function parseSseData(text: string): any[] {
  const out: any[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      out.push(JSON.parse(payload));
    } catch {
      /* partial/non-JSON line */
    }
  }
  return out;
}
