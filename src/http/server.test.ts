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
import { createHttpServer } from "./server.js";

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

  it("throttles a caller that exceeds the per-IP rate limit with 429", async () => {
    const db = await createTestDb();
    const ctx = makeCtx(db);
    const behaviors = createSqlBehaviors(db);
    await ensureBootstrapped(behaviors);
    const server = createHttpServer({ behaviors, ctx, rateLimit: { windowMs: 60_000, max: 2 } });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;

    const hit = () =>
      fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });

    const first = await hit();
    const second = await hit();
    const third = await hit();
    // First two are allowed (and fail auth as 401); the third trips the limiter.
    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(third.status).toBe(429);
  });
});
