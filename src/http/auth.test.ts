import { describe, it, expect } from "vitest";
import { importJWK, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createTestDb } from "../impl/test-db.js";
import { makeCtx } from "../impl/ctx.js";
import { configBehaviors } from "../impl/domains/config.js";
import { credentialBehaviors } from "../impl/domains/credentials.js";
import { UnauthorizedError } from "../impl/errors.js";
import { authenticate } from "./auth.js";

async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const creds = credentialBehaviors(ctx);
  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "admin@x.io", displayName: "Admin", kind: "admin" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "alice@x.io", displayName: "Alice" });
  const issued = await creds.issueUserKey({ actorId: admin.id, userId: alice.id });
  return { db, ctx, creds, admin, alice, issued };
}

interface SignOpts {
  sub: string;
  kid?: string;
  exp?: string | number;
  iat?: number;
  iss?: string;
  aud?: string;
}
async function signEdDSA(privateJwk: Record<string, unknown>, opts: SignOpts): Promise<string> {
  const key = await importJWK(privateJwk, "EdDSA");
  let b = new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", ...(opts.kid ? { kid: opts.kid } : {}) })
    .setSubject(opts.sub)
    .setIssuedAt(opts.iat);
  if (opts.exp !== undefined) b = b.setExpirationTime(opts.exp);
  if (opts.iss) b = b.setIssuer(opts.iss);
  if (opts.aud) b = b.setAudience(opts.aud);
  return b.sign(key);
}

describe("authenticate", () => {
  it("accepts a valid token and returns the userId", async () => {
    const { ctx, alice, issued } = await world();
    const token = await signEdDSA(issued.privateKey, { sub: alice.id, kid: issued.keyId, exp: "5m" });
    expect(await authenticate(ctx, `Bearer ${token}`)).toBe(alice.id);
  });

  it("honors optional issuer/audience when configured", async () => {
    const { ctx, alice, issued } = await world();
    const token = await signEdDSA(issued.privateKey, { sub: alice.id, kid: issued.keyId, exp: "5m", iss: "stamm", aud: "clients" });
    expect(await authenticate(ctx, `Bearer ${token}`, { issuer: "stamm", audience: "clients" })).toBe(alice.id);
    const wrong = await signEdDSA(issued.privateKey, { sub: alice.id, kid: issued.keyId, exp: "5m", iss: "evil" });
    await expect(authenticate(ctx, `Bearer ${wrong}`, { issuer: "stamm" })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects an expired token", async () => {
    const { ctx, alice, issued } = await world();
    const token = await signEdDSA(issued.privateKey, { sub: alice.id, kid: issued.keyId, exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(authenticate(ctx, `Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a token signed by a key the server does not hold", async () => {
    const { ctx, alice, issued } = await world();
    const { privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const otherJwk = (await exportJWK(privateKey)) as Record<string, unknown>;
    const token = await signEdDSA(otherJwk, { sub: alice.id, kid: issued.keyId, exp: "5m" });
    await expect(authenticate(ctx, `Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a token whose subject has no credentials", async () => {
    const { ctx, issued } = await world();
    const token = await signEdDSA(issued.privateKey, { sub: "ghost", exp: "5m" });
    await expect(authenticate(ctx, `Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a token signed with a revoked key", async () => {
    const { ctx, creds, admin, alice, issued } = await world();
    await creds.revokeUserKey({ actorId: admin.id, userId: alice.id, keyId: issued.keyId });
    const token = await signEdDSA(issued.privateKey, { sub: alice.id, kid: issued.keyId, exp: "5m" });
    await expect(authenticate(ctx, `Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects missing or malformed authorization headers", async () => {
    const { ctx } = await world();
    await expect(authenticate(ctx, undefined)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(authenticate(ctx, "Basic abc")).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(authenticate(ctx, "Bearer not.a.jwt")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a token with no expiration", async () => {
    const { ctx, alice, issued } = await world();
    const token = await signEdDSA(issued.privateKey, { sub: alice.id, kid: issued.keyId }); // no exp
    await expect(authenticate(ctx, `Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a token older than the max age even if exp is far in the future", async () => {
    const { ctx, alice, issued } = await world();
    const now = Math.floor(Date.now() / 1000);
    const token = await signEdDSA(issued.privateKey, { sub: alice.id, kid: issued.keyId, iat: now - 3600, exp: now + 3600 });
    await expect(authenticate(ctx, `Bearer ${token}`, { maxTokenAgeSec: 900 })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a token for a deactivated user", async () => {
    const { ctx, alice, issued } = await world();
    await ctx.db.insertInto("user_statuses").values({ id: "st-1", user_id: alice.id, status: "inactive" }).execute();
    const token = await signEdDSA(issued.privateKey, { sub: alice.id, kid: issued.keyId, exp: "5m" });
    await expect(authenticate(ctx, `Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a token for a deleted user (credential outlives the user row)", async () => {
    const { ctx, alice, issued } = await world();
    await ctx.db.deleteFrom("users").where("id", "=", alice.id).execute();
    const token = await signEdDSA(issued.privateKey, { sub: alice.id, kid: issued.keyId, exp: "5m" });
    await expect(authenticate(ctx, `Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects an HMAC (alg-confusion) token claiming a victim subject", async () => {
    const { ctx, alice } = await world();
    const secret = new TextEncoder().encode("attacker-controlled-secret");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(alice.id)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(secret);
    await expect(authenticate(ctx, `Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
