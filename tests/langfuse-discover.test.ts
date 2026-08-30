import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  looksLikeLangfuseHealth,
  mergeCreds,
  originFromLangfuseUrl,
  parseBasicAuthHeader,
  isLangfuseWebPsLine,
  parseDockerLangfusePorts,
  parseLangfuseInitEnvLines,
  parseLsofListenPorts,
  targetsFromDockerInspect,
} from "../src/langfuse/discover.ts";

test("Langfuse health fingerprint accepts OK status", () => {
  assert.equal(looksLikeLangfuseHealth({ status: "OK" }, 200), true);
  assert.equal(looksLikeLangfuseHealth({ version: "3.0" }, 200), true);
  assert.equal(looksLikeLangfuseHealth({ status: "OK" }, 404), false);
  assert.equal(looksLikeLangfuseHealth({ ok: true }, 200), false);
});

test("originFromLangfuseUrl strips MCP path", () => {
  assert.equal(originFromLangfuseUrl("https://cloud.langfuse.com/api/public/mcp"), "https://cloud.langfuse.com");
  assert.equal(originFromLangfuseUrl("http://127.0.0.1:4012/"), "http://127.0.0.1:4012");
});

test("parseBasicAuthHeader reads pk/sk", () => {
  const token = Buffer.from("pk-lf-aaa:sk-lf-bbb").toString("base64");
  const keys = parseBasicAuthHeader("Basic " + token);
  assert.deepEqual(keys, { publicKey: "pk-lf-aaa", secretKey: "sk-lf-bbb" });
  assert.equal(parseBasicAuthHeader("Bearer nope"), null);
});

test("mergeCreds does not apply cloud keys to a local host", () => {
  const bags = [
    { host: "https://cloud.langfuse.com", publicKey: "pk-lf-cloud", secretKey: "sk-lf-cloud" },
  ];
  assert.deepEqual(mergeCreds("http://127.0.0.1:3005", bags), { publicKey: "", secretKey: "" });
  assert.deepEqual(mergeCreds("https://cloud.langfuse.com", bags), { publicKey: "pk-lf-cloud", secretKey: "sk-lf-cloud" });
});

test("parseLangfuseInitEnvLines and inspect web port", () => {
  const keys = parseLangfuseInitEnvLines([
    "LANGFUSE_INIT_PROJECT_PUBLIC_KEY=pk-lf-local",
    "LANGFUSE_INIT_PROJECT_SECRET_KEY=sk-lf-local",
    "LANGFUSE_INIT_PROJECT_ID=proj-1",
  ]);
  assert.deepEqual(keys, { publicKey: "pk-lf-local", secretKey: "sk-lf-local", projectId: "proj-1" });
  const targets = targetsFromDockerInspect([
    {
      Config: { Image: "langfuse/langfuse:3", Env: ["LANGFUSE_INIT_PROJECT_PUBLIC_KEY=pk-lf-local", "LANGFUSE_INIT_PROJECT_SECRET_KEY=sk-lf-local"] },
      NetworkSettings: { Ports: { "3000/tcp": [{ HostPort: "3005" }] } },
    },
    {
      Config: { Image: "langfuse/langfuse-worker:3", Env: ["LANGFUSE_INIT_PROJECT_PUBLIC_KEY=pk-lf-local", "LANGFUSE_INIT_PROJECT_SECRET_KEY=sk-lf-local"] },
      NetworkSettings: { Ports: {} },
    },
  ]);
  assert.deepEqual(targets, [{ host: "http://127.0.0.1:3005", publicKey: "pk-lf-local", secretKey: "sk-lf-local", project: "default" }]);
});

test("parse listen and docker ports without assuming 3005", () => {
  const lsof = "node 1 u IPv4 TCP 127.0.0.1:4012 (LISTEN)\nnodes 2 u IPv4 TCP *:4599 (LISTEN)\n";
  assert.deepEqual(parseLsofListenPorts(lsof), [4012, 4599]);
  assert.deepEqual(
    parseDockerLangfusePorts("langfuse-web\tlangfuse/langfuse:3\t0.0.0.0:4012->3000/tcp"),
    [4012],
  );
  assert.deepEqual(
    parseDockerLangfusePorts(
      "langfuse-web\tlangfuse/langfuse:3\t0.0.0.0:3007->3000/tcp\n" +
        "fusion-langfuse-clickhouse-1\tclickhouse/clickhouse-server:25.12\t0.0.0.0:8123->8123/tcp, 0.0.0.0:9000->9000/tcp\n" +
        "fusion-langfuse-redis-1\tredis:7\t0.0.0.0:6379->6379/tcp\n" +
        "fusion-langfuse-minio-1\tminio/minio\t0.0.0.0:9090->9000/tcp\n" +
        "fusion-langfuse-worker-1\tlangfuse/langfuse-worker:3\t0.0.0.0:3030->3030/tcp",
    ),
    [3007],
  );
  assert.equal(isLangfuseWebPsLine("langfuse-web\tlangfuse/langfuse:3"), true);
  assert.equal(isLangfuseWebPsLine("fusion-langfuse-clickhouse-1\tclickhouse/clickhouse-server:25.12"), false);
  assert.equal(isLangfuseWebPsLine("fusion-langfuse-worker-1\tlangfuse/langfuse-worker:3"), false);
});

test("live health probe matches Langfuse shape", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/api/public/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "OK" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const host = `http://127.0.0.1:${addr.port}`;
  const res = await fetch(host + "/api/public/health");
  const body = await res.json();
  assert.equal(looksLikeLangfuseHealth(body, res.status), true);
  await new Promise<void>((r) => server.close(() => r()));
});
