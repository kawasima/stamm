import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createSqlBehaviors, makeCtx } from "../impl/index.js";
import { createTestDb } from "../impl/test-db.js";
import { ensureBootstrapped, issueSeedKeys } from "../impl/bootstrap.js";
import { createHttpServer } from "./server.js";
import { createBridge } from "./bridge.js";

const servers: Server[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

const listen = async (s: Server): Promise<number> => {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  return (s.address() as AddressInfo).port;
};

async function setup() {
  const db = await createTestDb();
  const behaviors = createSqlBehaviors(db);
  const seed = await ensureBootstrapped(behaviors);
  if (!seed) throw new Error("expected a fresh seed");
  const keys = await issueSeedKeys(behaviors, seed);
  const upstreamPort = await listen(
    createHttpServer({ behaviors, ctx: makeCtx(db), scopedBehaviors: (scope) => createSqlBehaviors(db, { scope }) }),
  );
  return { db, behaviors, seed, keys, upstream: `http://127.0.0.1:${upstreamPort}/mcp` };
}

async function viaBridge(url: string): Promise<Client> {
  // No Authorization header: the bridge supplies it.
  const client = new Client({ name: "t", version: "0" });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

describe("createBridge", () => {
  it("lets a client with no credentials use stamm as the key's user", async () => {
    const { upstream, keys, seed } = await setup();
    const port = await listen(createBridge({ upstream, key: keys.adminKey as never }));
    const client = await viaBridge(`http://127.0.0.1:${port}/mcp`);
    const r = await client.callTool({ name: "user_key_list", arguments: { userId: seed.adminId } });
    expect(r.isError).toBeFalsy();
  });

  it("carries the key's scope through (a read-only key gets no write tools)", async () => {
    const { upstream, behaviors, seed } = await setup();
    const key = await behaviors.issueUserKey({ actorId: seed.adminId, userId: seed.memberId, scope: { readOnly: true } });
    const port = await listen(createBridge({ upstream, key: key as never }));
    const client = await viaBridge(`http://127.0.0.1:${port}/mcp`);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("issue_get");
    expect(names).not.toContain("issue_create");
  });

  it("signs a new token per request, so a long-running client never sees one expire", async () => {
    const { upstream, keys } = await setup();
    const seen: string[] = [];
    const port = await listen(
      createBridge({
        upstream,
        key: keys.adminKey as never,
        fetch: (async (u: never, init: RequestInit) => {
          seen.push((init.headers as Record<string, string>).authorization);
          return fetch(u, init);
        }) as typeof fetch,
      }),
    );
    const client = await viaBridge(`http://127.0.0.1:${port}/mcp`);
    await client.listTools();
    await new Promise((r) => setTimeout(r, 1100));
    await client.listTools();
    // iat has one-second resolution, so compare the first and last token.
    const iat = (h: string) => JSON.parse(Buffer.from(h.split(".")[1], "base64url").toString()).iat as number;
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(iat(seen[seen.length - 1])).toBeGreaterThan(iat(seen[0]));
  });

  it("returns 502 when stamm is unreachable and never forwards without a signature", async () => {
    const { keys } = await setup();
    const port = await listen(createBridge({ upstream: "http://127.0.0.1:1/mcp", key: keys.adminKey as never }));
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(502);
  });

  it("surfaces upstream rejection of a revoked key as 401", async () => {
    const { upstream, behaviors, seed, keys } = await setup();
    await behaviors.revokeUserKey({ actorId: seed.adminId, userId: seed.adminId, keyId: keys.adminKey.keyId });
    const port = await listen(createBridge({ upstream, key: keys.adminKey as never }));
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("passes on when to come back after a limit", async () => {
    const { db, behaviors, keys } = await setup();
    const limited = await listen(createHttpServer({ behaviors, ctx: makeCtx(db), rateLimit: { callsPerMinute: 1 } }));
    const port = await listen(createBridge({ upstream: `http://127.0.0.1:${limited}/mcp`, key: keys.adminKey as never }));
    const post = () => fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect((await post()).status).toBe(200);
    const refused = await post();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("refuses callers outside the allowlist and serves those inside it", async () => {
    const { upstream, keys } = await setup();
    const denied = await listen(createBridge({ upstream, key: keys.adminKey as never, allowFrom: ["100.66.44.121"] }));
    const res = await fetch(`http://127.0.0.1:${denied}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(403);

    const allowed = await listen(createBridge({ upstream, key: keys.adminKey as never, allowFrom: ["127.0.0.1"] }));
    const client = await viaBridge(`http://127.0.0.1:${allowed}/mcp`);
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  });
});
