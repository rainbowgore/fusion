import type { Target } from "../config/schema.js";

/**
 * Thin client over the Langfuse public API (https://api.reference.langfuse.com/).
 * Fusion reaches OUT to this API — no plugin, no fork. Used for connection
 * validation, model-price registration, coverage/attribution checks, and the
 * gateway's ingestion write path.
 */

export interface ValidationResult {
  ok: boolean;
  health: "ok" | "unreachable" | "unhealthy";
  auth: "ok" | "unauthorized" | "unknown";
  message: string;
}

export class LangfuseClient {
  readonly host: string;
  private readonly authHeader: string | null;

  constructor(target: Pick<Target, "host" | "publicKey" | "secretKey">) {
    this.host = target.host.replace(/\/+$/, "");
    this.authHeader =
      target.publicKey && target.secretKey
        ? "Basic " + Buffer.from(`${target.publicKey}:${target.secretKey}`).toString("base64")
        : null;
  }

  private async request(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: "application/json", ...(init.headers as Record<string, string>) };
      if (this.authHeader) headers.Authorization = this.authHeader;
      if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
      return await fetch(`${this.host}${path}`, { ...init, headers, signal: ctrl.signal });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Langfuse timed out at ${this.host}`);
      }
      throw err;
    } finally {
      clearTimeout(t);
    }
  }

  /** Health (no auth) + an authed probe, so `init` can validate before saving. */
  async validate(): Promise<ValidationResult> {
    let health: ValidationResult["health"] = "unreachable";
    try {
      const res = await this.request("/api/public/health", {}, 5000);
      health = res.ok ? "ok" : "unhealthy";
    } catch {
      return { ok: false, health: "unreachable", auth: "unknown", message: `Langfuse not reachable at ${this.host}` };
    }
    if (!this.authHeader) {
      return { ok: false, health, auth: "unknown", message: "Reachable, but no keys provided to validate auth." };
    }
    try {
      // Cheapest authed call: list one trace. 200/empty is fine; 401/403 = bad keys.
      const res = await this.request("/api/public/traces?limit=1", {}, 6000);
      if (res.status === 401 || res.status === 403) {
        return { ok: false, health, auth: "unauthorized", message: "Keys rejected by Langfuse (401/403)." };
      }
      if (!res.ok) {
        return { ok: false, health, auth: "unknown", message: `Unexpected status ${res.status} from traces API.` };
      }
      return { ok: true, health, auth: "ok", message: `Connected to Langfuse at ${this.host}.` };
    } catch {
      return { ok: false, health, auth: "unknown", message: "Auth probe failed (network/timeout)." };
    }
  }

  /** GET /api/public/traces — paginated trace listing (used for coverage/attribution checks). */
  async listTraces(params: { page?: number; limit?: number; tags?: string[]; fromTimestamp?: string; toTimestamp?: string } = {}): Promise<TracesResponse> {
    const q = new URLSearchParams();
    q.set("page", String(params.page ?? 1));
    q.set("limit", String(params.limit ?? 50));
    for (const tag of params.tags ?? []) q.append("tags", tag);
    if (params.fromTimestamp) q.set("fromTimestamp", params.fromTimestamp);
    if (params.toTimestamp) q.set("toTimestamp", params.toTimestamp);
    const res = await this.request(`/api/public/traces?${q.toString()}`, {}, 8000);
    if (!res.ok) throw new Error(`list traces failed: HTTP ${res.status}`);
    return (await res.json()) as TracesResponse;
  }

  /** GET /api/public/observations — recent generations (to check price coverage). */
  async listObservations(params: { type?: string; limit?: number; page?: number; fromTimestamp?: string } = {}): Promise<ObservationsResponse> {
    const q = new URLSearchParams();
    q.set("type", params.type ?? "GENERATION");
    q.set("limit", String(params.limit ?? 50));
    q.set("page", String(params.page ?? 1));
    if (params.fromTimestamp) q.set("fromTimestamp", params.fromTimestamp);
    const res = await this.request(`/api/public/observations?${q.toString()}`);
    if (!res.ok) throw new Error(`list observations failed: HTTP ${res.status}`);
    return (await res.json()) as ObservationsResponse;
  }

  /** GET /api/public/projects — the project this *project* key belongs to. */
  async listProjects(): Promise<{ id: string; name: string }[]> {
    const res = await this.request(`/api/public/projects?limit=100`, {}, 8000);
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
    return (body.data ?? []).filter((p) => p.id && p.name).map((p) => ({ id: p.id as string, name: p.name as string }));
  }

  /** GET /api/public/organizations/projects — all org projects (org-scoped key). */
  async listOrganizationProjects(): Promise<{ id: string; name: string }[]> {
    const res = await this.request(`/api/public/organizations/projects?limit=100`, {}, 8000);
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
    return (body.data ?? []).filter((p) => p.id && p.name).map((p) => ({ id: p.id as string, name: p.name as string }));
  }

  /** GET /api/public/models — existing model/price definitions on this target. */
  async listModels(page = 1, limit = 100): Promise<ModelsResponse> {
    const res = await this.request(`/api/public/models?page=${page}&limit=${limit}`);
    if (!res.ok) throw new Error(`list models failed: HTTP ${res.status}`);
    return (await res.json()) as ModelsResponse;
  }

  /** POST /api/public/models — register a model price so Langfuse computes cost. */
  async createModel(def: ModelDefinition): Promise<{ ok: boolean; status: number }> {
    const res = await this.request(`/api/public/models`, { method: "POST", body: JSON.stringify(def) });
    return { ok: res.ok, status: res.status };
  }

  /** POST /api/public/ingestion — the gateway's write path (traces + generations). */
  async ingest(batch: IngestionEvent[]): Promise<{ ok: boolean; status: number }> {
    const res = await this.request(`/api/public/ingestion`, { method: "POST", body: JSON.stringify({ batch }) });
    return { ok: res.ok, status: res.status };
  }
}

export interface IngestionEvent {
  id: string;
  type: string; // "trace-create" | "generation-create" | "observation-create"
  timestamp: string;
  body: Record<string, unknown>;
}

export interface TracesResponse {
  data: Array<{ id: string; name?: string | null; tags?: string[]; timestamp: string; totalCost?: number | null }>;
  meta: { page: number; limit: number; totalItems: number; totalPages: number };
}

export interface ObservationsResponse {
  data: Array<{ id: string; model?: string | null; calculatedTotalCost?: number | null; usage?: { input?: number; output?: number; total?: number } | null }>;
  meta: { page: number; limit: number; totalItems: number; totalPages: number };
}

export interface ModelsResponse {
  data: Array<{ id: string; modelName: string; matchPattern: string }>;
  meta: { page: number; limit: number; totalItems: number; totalPages: number };
}

export interface ModelDefinition {
  modelName: string;
  matchPattern: string;
  unit?: "TOKENS" | "CHARACTERS" | "SECONDS" | "MILLISECONDS" | "IMAGES" | "REQUESTS";
  inputPrice?: number;
  outputPrice?: number;
  totalPrice?: number;
  tokenizerId?: string;
  /** Fusion-internal mapping to an external price source (e.g. OpenRouter model id). Stripped before sending to Langfuse. */
  sourceId?: string;
}
