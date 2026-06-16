import { describe, it, expect } from "vitest";
import { ForbiddenError, NotFoundError } from "../errors.js";
import { createTestDb } from "../test-db.js";
import { makeCtx } from "../ctx.js";
import { configBehaviors } from "./config.js";
import { credentialBehaviors } from "./credentials.js";

async function world() {
  const db = await createTestDb();
  const ctx = makeCtx(db);
  const config = configBehaviors(ctx);
  const creds = credentialBehaviors(ctx);
  const admin = await config.createUser({ actorId: "boot", login: "admin", email: "admin@x.io", displayName: "Admin", kind: "admin" });
  const alice = await config.createUser({ actorId: admin.id, login: "alice", email: "alice@x.io", displayName: "Alice" });
  return { db, ctx, config, creds, admin, alice };
}

describe("credentialBehaviors", () => {
  it("issues a keypair and persists only the public key", async () => {
    const { db, creds, admin, alice } = await world();
    const issued = await creds.issueUserKey({ actorId: admin.id, userId: alice.id });

    expect(issued.algorithm).toBe("EdDSA");
    expect(issued.privateKey.d).toBeDefined(); // Ed25519 private scalar
    expect(issued.publicKey.d).toBeUndefined();

    const rows = await db.selectFrom("user_credentials").selectAll().where("user_id", "=", alice.id).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at).toBeNull();
    expect(rows[0].key_id).toBe(issued.keyId);
    const storedJwk = JSON.parse(rows[0].public_key);
    expect(storedJwk.d).toBeUndefined(); // no private material ever stored
  });

  it("rejects a non-admin actor", async () => {
    const { creds, alice } = await world();
    await expect(creds.issueUserKey({ actorId: alice.id, userId: alice.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects an unknown user", async () => {
    const { creds, admin } = await world();
    await expect(creds.issueUserKey({ actorId: admin.id, userId: "ghost" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("revokes a key and rejects a double revoke", async () => {
    const { creds, admin, alice } = await world();
    const issued = await creds.issueUserKey({ actorId: admin.id, userId: alice.id });
    await creds.revokeUserKey({ actorId: admin.id, userId: alice.id, keyId: issued.keyId });
    await expect(creds.revokeUserKey({ actorId: admin.id, userId: alice.id, keyId: issued.keyId })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists only metadata (no signable key material)", async () => {
    const { creds, admin, alice } = await world();
    const issued = await creds.issueUserKey({ actorId: admin.id, userId: alice.id });
    const { items } = await creds.listUserKeys({ actorId: admin.id, userId: alice.id });
    expect(items).toHaveLength(1);
    expect(items[0].keyId).toBe(issued.keyId);
    expect((items[0] as Record<string, unknown>).publicKey).toBeUndefined();
    expect((items[0] as Record<string, unknown>).privateKey).toBeUndefined();
  });
});
