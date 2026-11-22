import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { importJWK, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createSqlBehaviors, makeCtx } from "../impl/index.js";
import { createTestDb } from "../impl/test-db.js";
import { ensureBootstrapped, issueSeedKeys } from "../impl/bootstrap.js";
import type { IssuedCredential } from "../schema/index.js";
import { createHttpServer, type RateLimitOptions } from "./server.js";

const servers: Server[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function start(opts: { scoped?: boolean } = { scoped: true }) {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const behaviors = createSqlBehaviors(db);
  const seed = await ensureBootstrapped(behaviors);
  if (!seed) throw new Error("expected a fresh seed");
  const keys = await issueSeedKeys(behaviors, seed);
  const server = createHttpServer({
    behaviors,
    ctx,
    ...(opts.scoped ? { scopedBehaviors: (scope) => createSqlBehaviors(db, { scope }) } : {}),
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return { port, seed, keys, behaviors };
}

async function tokenFor(userId: string, key: IssuedCredential): Promise<string> {
  const signingKey = await importJWK(key.privateKey, "EdDSA");
  return new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", kid: key.keyId })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(signingKey);
}

async function connect(port: number, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  clients.push(client);
  await client.connect(transport);
  return client;
}

describe("createHttpServer", () => {
  it("authenticates and pins the actor to the token subject", async () => {
    const { port, seed, keys } = await start();

    // Admin token → admin-only tool succeeds.
    const adminClient = await connect(port, await tokenFor(seed.adminId, keys.adminKey));
    const adminResult = await adminClient.callTool({ name: "user_key_list", arguments: { userId: seed.adminId } });
    expect(adminResult.isError).toBeFalsy();
    expect((adminResult.structuredContent as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);

    // Member token → same admin-only tool is forbidden, proving the actor is the
    // member (not a shared/leaked identity).
    const memberClient = await connect(port, await tokenFor(seed.memberId, keys.memberKey));
    const memberResult = await memberClient.callTool({ name: "user_key_list", arguments: { userId: seed.memberId } });
    expect(memberResult.isError).toBe(true);
  });

  it("serves a read-only key a read-only tool surface and refuses its writes", async () => {
    const { port, seed, behaviors } = await start();
    const key = await behaviors.issueUserKey({ actorId: seed.adminId, userId: seed.memberId, scope: { readOnly: true } });
    const client = await connect(port, await tokenFor(seed.memberId, key));

    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("issue_search");
    expect(names).not.toContain("issue_create");
    expect((await client.callTool({ name: "issue_search", arguments: { filter: {}, pagination: { limit: 5 } } })).isError).toBeFalsy();
    expect((await client.callTool({ name: "issue_create", arguments: {} })).isError).toBe(true);
  });

  it("refuses a scoped key rather than serving it unrestricted when scopedBehaviors is not configured", async () => {
    const { port, seed, behaviors } = await start({});
    const key = await behaviors.issueUserKey({ actorId: seed.adminId, userId: seed.memberId, scope: { readOnly: true } });
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${await tokenFor(seed.memberId, key)}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(500);
  });

  it("hands the project's Code of Conduct to the client as instructions on connect", async () => {
    const { port, seed, keys, behaviors } = await start();
    const client0 = await connect(port, await tokenFor(seed.memberId, keys.memberKey));
    expect(client0.getInstructions()).toBeUndefined();

    const proj = await behaviors.createProject({ actorId: seed.adminId, identifier: "coc", name: "CoC" });
    await behaviors.updateProject({ actorId: seed.adminId, projectId: proj.id, codeOfConduct: "MARKER-COC" });
    const adminClient = await connect(port, await tokenFor(seed.adminId, keys.adminKey));
    expect(adminClient.getInstructions()).toContain("MARKER-COC");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { port } = await start();
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(401);
  });

  describe("limits", () => {
    /** Two keys of two users, and a clock the test moves. */
    async function limited(rateLimit: RateLimitOptions | false) {
      const db = await createTestDb();
      const ctx = makeCtx(db);
      const behaviors = createSqlBehaviors(db);
      const seed = (await ensureBootstrapped(behaviors))!;
      const keys = await issueSeedKeys(behaviors, seed);
      let now = 1_000_000;
      const server = createHttpServer({ behaviors, ctx, rateLimit, now: () => now });
      servers.push(server);
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      const port = (server.address() as AddressInfo).port;
      const admin = await tokenFor(seed.adminId, keys.adminKey);
      const member = await tokenFor(seed.memberId, keys.memberKey);
      const call = (id = 1) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "project_list", arguments: { pagination: { limit: 1 } } } });
      const post = (token: string | undefined, body: unknown = call()) =>
        fetch(`http://127.0.0.1:${port}/mcp`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(body),
        });
      const statuses = async (n: number, token?: string) => {
        const out: number[] = [];
        for (let i = 0; i < n; i++) out.push((await post(token)).status);
        return out;
      };
      return { behaviors, seed, keys, admin, member, call, post, statuses, advance: (ms: number) => { now += ms; } };
    }

    it("limits each key on its own, says when to come back, and lets it back in then", async () => {
      const w = await limited({ callsPerMinute: 6 }); // 2 at once, then one every 10 s
      expect(await w.statuses(3, w.member)).toEqual([200, 200, 429]);
      expect(await w.statuses(1, w.admin)).toEqual([200]); // same address, another key
      const refused = await w.post(w.member);
      expect(refused.headers.get("retry-after")).toBe("10");
      w.advance(9_000);
      expect(await w.statuses(1, w.member)).toEqual([429]);
      w.advance(1_000);
      expect(await w.statuses(2, w.member)).toEqual([200, 429]);
    });

    it("counts the calls in a batch, not the request that carries them", async () => {
      const w = await limited({ callsPerMinute: 30 }); // 10 at once
      const batch = (n: number) => Array.from({ length: n }, (_, i) => w.call(i + 1));
      expect((await w.post(w.member, batch(11))).status).toBe(413); // never possible
      w.advance(60_000);
      expect((await w.post(w.member, batch(8))).status).toBe(200);
      expect((await w.post(w.member, batch(3))).status).toBe(429);
    });

    it("gives two keys of one user a budget each", async () => {
      const w = await limited({ callsPerMinute: 3 });
      const second = await w.behaviors.issueUserKey({ actorId: w.seed.adminId, userId: w.seed.memberId });
      expect(await w.statuses(2, w.member)).toEqual([200, 429]);
      expect(await w.statuses(1, await tokenFor(w.seed.memberId, second))).toEqual([200]);
    });

    it("limits failed authentications per address without touching keys in use there", async () => {
      const w = await limited({ failuresPerMinute: 3 });
      expect(await w.statuses(1, w.member)).toEqual([200]);
      expect(await w.statuses(5)).toEqual([401, 401, 401, 429, 429]);
      expect((await w.post(undefined)).headers.get("retry-after")).toBe("20");
      expect(await w.statuses(5, w.member)).toEqual([200, 200, 200, 200, 200]);
      // a key not yet seen here waits like everyone else, then is let in and stays in
      expect(await w.statuses(1, w.admin)).toEqual([429]);
      w.advance(20_000);
      expect(await w.statuses(1, w.admin)).toEqual([200]);
      expect(await w.statuses(1)).toEqual([401]);
      expect(await w.statuses(2, w.admin)).toEqual([200, 200]);
    });

    it("does not let a client retrying a revoked key lock out the others behind its address", async () => {
      const w = await limited({ failuresPerMinute: 3 });
      expect(await w.statuses(1, w.member)).toEqual([200]);
      expect(await w.statuses(1, w.admin)).toEqual([200]);
      await w.behaviors.revokeUserKey({ actorId: w.seed.adminId, userId: w.seed.memberId, keyId: w.keys.memberKey.keyId });
      expect(new Set(await w.statuses(8, w.member))).toEqual(new Set([401]));
      expect(await w.statuses(3, w.admin)).toEqual([200, 200, 200]);
      w.advance(6 * 60_000); // no longer remembered: now it is refused before any work
      expect(await w.statuses(5, w.member)).toEqual([401, 401, 401, 429, 429]);
    });

    it("can be turned off", async () => {
      const w = await limited(false);
      expect(new Set(await w.statuses(20, w.member))).toEqual(new Set([200]));
      expect((await w.post(w.member, Array.from({ length: 300 }, (_, i) => w.call(i + 1)))).status).toBe(200);
    });
  });
});
