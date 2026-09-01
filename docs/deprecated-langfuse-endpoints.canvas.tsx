import { Callout, Card, CardBody, CardHeader, CollapsibleSection, Divider, Grid, H1, H2, H3, Link, Pill, Row, Stack, Stat, Table, Text, useHostTheme } from "cursor/canvas";

type Hit = {
  project: string;
  path: string;
  method: string;
  replacement: string;
  files: string;
  role: string;
};

const HITS: Hit[] = [
  {
    project: "fusion",
    path: "/api/public/traces",
    method: "GET",
    replacement: "GET /v2/observations?traceId=",
    files: "src/langfuse/client.ts (validate, listTraces); src/engine/coverage.ts; src/health.ts via validate",
    role: "Auth probe, coverage attribution, flow probe",
  },
  {
    project: "fusion",
    path: "/api/public/observations",
    method: "GET",
    replacement: "GET /v2/observations",
    files: "src/langfuse/client.ts (listObservations); src/health.ts",
    role: "Price coverage on recent generations",
  },
  {
    project: "fusion",
    path: "/api/public/ingestion",
    method: "POST",
    replacement: "POST /otel/v1/traces",
    files: "src/langfuse/client.ts (ingest); src/core/gateway.ts; src/core/buffer.ts",
    role: "Gateway write path for traces + generations",
  },
  {
    project: "dev-ai-usage",
    path: "/api/public/observations",
    method: "GET",
    replacement: "GET /v2/observations",
    files: "assessment/fetch_langfuse_generations.py",
    role: "Legacy generations pull; comment says v2 omits real model",
  },
  {
    project: "dev-ai-usage",
    path: "/api/public/v2/scores",
    method: "GET",
    replacement: "GET /v3/scores",
    files: "assessment/fetch_langfuse_generations.py; backfill_intent_met.py; cleanup_empty_intent_met.py",
    role: "intent_met score listing",
  },
  {
    project: "dev-ai-usage",
    path: "/api/public/sessions",
    method: "GET",
    replacement: "GET /v2/observations?sessionId=",
    files: "assessment/backfill_intent_met.py",
    role: "Enumerate session IDs for scoring backfill",
  },
  {
    project: "github-oss-buddy",
    path: "/api/public/traces",
    method: "GET",
    replacement: "GET /v2/observations?traceId=",
    files: "orchestrator/score_outcomes.py",
    role: "Iterate OSS e2e traces for scoring",
  },
  {
    project: "github-oss-buddy",
    path: "/api/public/scores",
    method: "GET",
    replacement: "GET /v3/scores",
    files: "orchestrator/decision_dataset.py; orchestrator/bank_feedback.py",
    role: "Read label.triage_correct and label.pr_outcome",
  },
  {
    project: "github-oss-buddy",
    path: "/api/public/ingestion",
    method: "POST",
    replacement: "POST /otel/v1/traces",
    files: "oss-suite/oss-e2e/scripts/telemetry.py",
    role: "Emit e2e telemetry batch events",
  },
  {
    project: "agent-fleet",
    path: "/api/public/traces",
    method: "GET",
    replacement: "GET /v2/observations?traceId=",
    files: "src/agent_arch/trace/langfuse_traces.py; langfuse_runs.py",
    role: "Obs panel + run inventory",
  },
  {
    project: "claude-setup",
    path: "/api/public/traces",
    method: "GET",
    replacement: "GET /v2/observations?traceId=",
    files: "dashboard.html (fetchUsage, fetchCurrentSession)",
    role: "Usage and current-session cards",
  },
  {
    project: "claude-setup",
    path: "/api/public/observations",
    method: "GET",
    replacement: "GET /v2/observations",
    files: "dashboard.html (fetchFailures)",
    role: "WARNING-level failure table",
  },
  {
    project: "Scripts",
    path: "/api/public/traces",
    method: "GET",
    replacement: "GET /v2/observations?traceId=",
    files: "langfuse-delete-old-traces.py",
    role: "List traces before DELETE /traces (DELETE is still the replacement)",
  },
];

const PROJECTS = [
  { name: "fusion", endpoints: 3, severity: "core write + read" },
  { name: "dev-ai-usage", endpoints: 3, severity: "assessment jobs" },
  { name: "github-oss-buddy", endpoints: 3, severity: "orchestrator + e2e" },
  { name: "agent-fleet", endpoints: 1, severity: "read UI" },
  { name: "claude-setup", endpoints: 2, severity: "dashboard" },
  { name: "Scripts", endpoints: 1, severity: "ops script" },
];

const UNUSED = [
  { deprecated: "GET /metrics, GET /metrics/daily", replacement: "GET /v2/metrics" },
  { deprecated: "GET /datasets/{name}/runs[+/{runName}]", replacement: "GET /experiments then /experiment-items" },
  { deprecated: "GET /dataset-run-items", replacement: "GET /experiment-items" },
  { deprecated: "DELETE /datasets/{name}/runs/{runName}", replacement: "DELETE /traces (no direct swap)" },
  { deprecated: "POST /dataset-run-items", replacement: "Experiment runner SDK or OTLP + attrs" },
  { deprecated: "POST /traces, /spans, /generations, /events", replacement: "POST /otel/v1/traces" },
];

export default function DeprecatedLangfuseEndpoints() {
  const theme = useHostTheme();

  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 1100 }}>
      <Stack gap={8}>
        <H1>Deprecated Langfuse endpoints — local inventory</H1>
        <Text tone="secondary" size="small">
          Source: ripgrep over /Users/noasasson/Dev-projects (node_modules, third_party, litellm tests excluded from primary hits). Read-only search; no files changed. Searched 2026-09-01.
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="6" label="First-party projects with live calls" />
        <Stat value="13" label="Distinct project × endpoint hits" tone="warning" />
        <Stat value="6" label="Deprecated families with no local callers" />
        <Stat value="3" label="Projects writing via POST /ingestion" tone="warning" />
      </Grid>

      <Callout tone="warning" title="Heaviest coupling">
        fusion is the only first-party stack that both reads the old GET surfaces and writes through POST /api/public/ingestion (gateway + spool). github-oss-buddy e2e telemetry and the copied skill scripts also POST /ingestion.
      </Callout>

      <H2>Projects</H2>
      <Row gap={8} wrap>
        {PROJECTS.map((p) => (
          <span key={p.name}>
            <Pill tone="warning" active>
              {p.name} · {p.endpoints} families · {p.severity}
            </Pill>
          </span>
        ))}
      </Row>

      <H2>Live callers</H2>
      <Table
        headers={["Project", "Call", "Replacement", "Where / why"]}
        rows={HITS.map((h) => [
          h.project,
          `${h.method} ${h.path}`,
          h.replacement,
          `${h.files} — ${h.role}`,
        ])}
        columnAlign={["left", "left", "left", "left"]}
        rowTone={HITS.map((h) => (h.method === "POST" ? "warning" : undefined))}
      />

      <H2>By endpoint family</H2>
      <Grid columns={2} gap={12}>
        <Card>
          <CardHeader>GET /traces</CardHeader>
          <CardBody>
            <Text size="small">fusion, github-oss-buddy, agent-fleet, claude-setup, Scripts</Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>GET /observations</CardHeader>
          <CardBody>
            <Text size="small">fusion, dev-ai-usage, claude-setup</Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>GET /sessions</CardHeader>
          <CardBody>
            <Text size="small">dev-ai-usage only (backfill_intent_met.py)</Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>GET /scores and GET /v2/scores</CardHeader>
          <CardBody>
            <Text size="small">github-oss-buddy uses v1; dev-ai-usage uses v2</Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>POST /ingestion</CardHeader>
          <CardBody>
            <Text size="small">fusion gateway/buffer; github-oss-buddy oss-e2e telemetry; skill copies of that script</Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="neutral">docs only</Pill>}>
            claude-cost-tracker
          </CardHeader>
          <CardBody>
            <Text size="small">CLAUDE.md documents GET /traces and GET /observations; no implementation hits outside third_party.</Text>
          </CardBody>
        </Card>
      </Grid>

      <H2>Not found in first-party code</H2>
      <Table
        headers={["Deprecated", "Replacement"]}
        rows={UNUSED.map((u) => [u.deprecated, u.replacement])}
      />

      <Divider />

      <H3>Adjacent, not flagged</H3>
      <Stack gap={6}>
        <Text size="small" tone="secondary">
          POST /api/public/scores and DELETE /api/public/scores in dev-ai-usage are not on the deprecation list (only GET /scores and GET /v2/scores).
        </Text>
        <Text size="small" tone="secondary">
          DELETE /api/public/traces in Scripts/langfuse-delete-old-traces.py is the documented replacement for deleting dataset-run data, not a deprecated ingest path.
        </Text>
        <Text size="small" tone="secondary">
          litellm production code has no hardcoded /api/public/* paths; LangFuseLogger uses the official Python SDK (historically ingestion). A separate langfuse_otel integration exists. Tests mention the old HTTP paths.
        </Text>
        <Text size="small" tone="secondary">
          Skill copies: ~/.cursor/skills/bug-e2e/scripts/telemetry.py and github-oss-buddy oss-e2e telemetry both POST /ingestion. latent-ai-ha only stores Langfuse UI dataset-run URLs, not API calls.
        </Text>
        <Text size="small" style={{ color: theme.text.secondary }}>
          fusion tests (tests/functional/setup.ts, tests/hermes-user-path.test.ts) mock /ingestion, /traces, and /observations — they are fixtures, not extra products.
        </Text>
      </Stack>

      <Divider />

      <Stack gap={8}>
        <H1>Langfuse v4 migration guide</H1>
        <Text tone="secondary" size="small">
          Official docs read 2026-09-01. Applied to the inventory above; no project files changed.
        </Text>
        <Row gap={16} wrap>
          <Link href="https://langfuse.com/faq/all/deprecated-api-migration">Deprecated API migration</Link>
          <Link href="https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4">Self-host v3 to v4</Link>
          <Link href="https://langfuse.com/integrations/native/opentelemetry/migration-to-v4">Custom ingestion to OTEL</Link>
        </Row>
      </Stack>

      <Grid columns={3} gap={12}>
        <Stat value="2026-11-16" label="Cloud cutoff for deprecated routes" tone="warning" />
        <Stat value="404" label="Those routes after events_only cutover" tone="danger" />
        <Stat value="Jan 2027" label="v3 security patches end (self-host)" />
      </Grid>

      <Callout tone="warning" title="Observations-first model">
        A trace is no longer a separate row. It is the set of observations sharing a traceId. Overall I/O lives on the root observation (parentObservationId is null). After cutover, GET /traces, /observations, /sessions, /scores, /v2/scores, /metrics, and dataset-run routes return 404. POST /ingestion keeps HTTP 207 but returns 400 for every event type except score-create and sdk-log.
      </Callout>

      <H2>Self-host server path</H2>
      <Text size="small" tone="secondary">
        Fusion still ships langfuse/langfuse:3. These three steps are independent; legacy and dual write modes are temporary and will be removed in a later major.
      </Text>
      <Table
        headers={["Step", "What", "Local note"]}
        rows={[
          ["1. Infra", "ClickHouse 25.12 min / 26.4 rec; Postgres 15 / Redis 7. Stay on Langfuse v3 while doing this.", "Upgrade ClickHouse before the Langfuse image."],
          ["2. Server", "Deploy Langfuse v4 in legacy (v3 behavior) or dual (write old + new tables).", "events_only is the default and is already the cutover."],
          ["3. Clients + cutover", "Move SDKs and API consumers, then drop overrides so write mode is events_only.", "Deprecated endpoints 404 from this point. No rollback of new writes."],
        ]}
      />
      <Text size="small" tone="secondary">
        Real-time v4 writes: Python SDK 4.7.0+, JS/TS SDK 5.4.0+, or OTEL with header x-langfuse-ingestion-version: 4. Older SDKs in dual can lag about 15 minutes. Historic backfill needs ~3x ClickHouse disk, or skip it and dual-write for one full retention window.
      </Text>

      <H2>What each local caller must become</H2>
      <Table
        headers={["Inventory hit", "Official replacement", "Breakage if you only swap the URL"]}
        rows={[
          [
            "GET /traces — fusion, oss-buddy, agent-fleet, claude-setup, Scripts",
            "GET /v2/observations, group by traceId",
            "Rows are observations, not traces. tags/name become filter. fromTimestamp becomes fromStartTime. No orderBy. page becomes cursor. Always bound time. Request fields=core,basic,trace_context. Trace I/O = root row.",
          ],
          [
            "GET /observations — fusion, dev-ai-usage, claude-setup",
            "GET /v2/observations",
            "Default fields=core,basic omit model/usage. Prices need the model group and come back as strings. input/output are raw strings. parseIoAsJson=true returns 400. Matches the comment in fetch_langfuse_generations.py.",
          ],
          [
            "GET /sessions — dev-ai-usage",
            "GET /v2/observations filtered on sessionId",
            "No session object. Group client-side by sessionId, then traceId.",
          ],
          [
            "GET /scores and GET /v2/scores — oss-buddy, dev-ai-usage",
            "GET /v3/scores",
            "One typed value. IDs move into subject. datasetRunId becomes experimentId. userId/traceTags/filter removed. fromTimestamp inclusive, toTimestamp exclusive. v3 returns orphan scores v2 dropped.",
          ],
          [
            "POST /ingestion traces — fusion gateway/buffer, oss-e2e telemetry",
            "POST /otel/v1/traces",
            "Do not map create/update events 1:1. Export one complete OTEL span once. Copy user/session/tags onto every span. Trace I/O becomes langfuse.observation.input/output on the root. Do not dual-send the same IDs via REST and OTEL.",
          ],
        ]}
        rowTone={["neutral", "neutral", "neutral", "neutral", "warning"]}
      />

      <H2>Still valid after cutover</H2>
      <Grid columns={2} gap={12}>
        <Card>
          <CardHeader>Keep as-is</CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text size="small">POST /scores and SDK score-create batched through /ingestion (dev-ai-usage backfill writes).</Text>
              <Text size="small">DELETE /traces (Scripts) — still the way to remove underlying data; there is no experiment-delete API.</Text>
              <Text size="small">GET /v2/datasets and models/projects/health — not on this deprecation list.</Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>Not in first-party REST, still 404 on v4</CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text size="small">GET /metrics and /metrics/daily → GET /v2/metrics (drop view: traces; count traces with isRootObservation=true).</Text>
              <Text size="small">Dataset-run reads → GET /experiments then GET /experiment-items (query by datasetId, not name).</Text>
              <Text size="small">POST /dataset-run-items must not be used on v4. Use the experiment runner SDK or OTEL + experiment attributes.</Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <H2>SDK-only writers (no hardcoded /api/public paths)</H2>
      <Text size="small">
        tenta, aira, sentinel-ha, latent-ai-ha, Hermes Langfuse plugins, agent-fleet langfuse_bridge, github-oss-buddy langfuse_buddy. Upgrading the SDK major is separate from swapping REST helpers: current majors still expose deprecated API methods. Tracing should be Python 4.7.0+ or JS 5.4.0+ so it exports OTEL instead of ingestion.batch for traces. Scores v3 helpers need Python 4.8.1+ / JS 5.5.0+. Experiment reads need Python 4.13.1+ / JS 5.10.0+.
      </Text>

      <H2>Self-host extras that are not API clients</H2>
      <Table
        headers={["Surface", "After events_only"]}
        rows={[
          ["Trace-level and legacy-dataset LLM-as-judge evaluators", "Stop running. Recreate as observation-level evaluators."],
          ["Export source Traces and observations (legacy)", "Stops producing data. Switch blob/PostHog/Mixpanel to Enriched observations."],
          ["Python SDK v2 / JS SDK v3 and older", "Rejected at ingestion."],
        ]}
      />

      <H2>Official canary before cutover</H2>
      <Text size="small">
        Send one root span, one generation, and one child with a unique tag. Confirm all three appear without the legacy delay; hierarchy and timings are correct; root has overall I/O; user/session/tags/environment exist on every observation you filter on; generation has model, usage, and cost; GET /v2/observations returns the rows. Then stop sending trace/span/generation events to /ingestion.
      </Text>

      <CollapsibleSection title="Parameter mappings from the official guide" defaultOpen={false}>
        <Stack gap={12} style={{ paddingTop: 8 }}>
          <H3>Observations and traces → v2</H3>
          <Table
            headers={["Old", "v2"]}
            rows={[
              ["page", "cursor from meta.cursor"],
              ["limit max 100", "limit max 1,000"],
              ["GET /observations/{id}", "filter on id; no single-item getter"],
              ["GET /traces/{id}", "traceId="],
              ["fromTimestamp / toTimestamp", "fromStartTime / toStartTime"],
              ["trace name / tags / sessionId", "filter on traceName, tags, sessionId"],
              ["orderBy", "removed; always startTime desc"],
            ]}
          />
          <H3>Scores → v3</H3>
          <Table
            headers={["Old v1/v2", "v3"]}
            rows={[
              ["page", "cursor; limit max 100"],
              ["GET .../scores/{id}", "id= filter; always a list"],
              ["value + stringValue", "one value typed by dataType"],
              ["datasetRunId", "experimentId"],
              ["userId, traceTags, JSON filter", "removed"],
              ["traceId + sessionId together", "use at most one of traceId, sessionId, experimentId"],
            ]}
          />
        </Stack>
      </CollapsibleSection>

      <Text size="small" style={{ color: theme.text.tertiary }}>
        Sources: langfuse.com/faq/all/deprecated-api-migration · langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4 · langfuse.com/integrations/native/opentelemetry/migration-to-v4
      </Text>
    </Stack>
  );
}
