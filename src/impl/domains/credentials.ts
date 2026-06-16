import { generateKeyPair, exportJWK } from "jose";
import { UserCredential } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { assertGlobalAdmin } from "../permissions.js";

type CredentialMethods = "issueUserKey" | "revokeUserKey" | "listUserKeys";

/**
 * Per-user JWT signing keys. Asymmetric (EdDSA/Ed25519): the server persists
 * only the public key; the private key is returned once at issuance. These run
 * through raw Kysely (not the User codec) so secrets never touch the User read
 * path. All three are admin-only — the first key must be minted by an already
 * trusted admin (the bootstrap admin), avoiding a self-issuance escalation.
 */
export function credentialBehaviors(ctx: Ctx): Pick<Behaviors, CredentialMethods> {
  const db = ctx.db;

  return {
    issueUserKey: async ({ actorId, userId }) => {
      await assertGlobalAdmin(ctx, actorId);
      const user = await db.selectFrom("users").select("id").where("id", "=", userId).executeTakeFirst();
      if (!user) throw new NotFoundError("User", userId);

      const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
      const publicJwk = await exportJWK(publicKey);
      const privateJwk = await exportJWK(privateKey);
      const keyId = ctx.genId();

      await db
        .insertInto("user_credentials")
        .values({
          id: ctx.genId(),
          user_id: userId,
          key_id: keyId,
          algorithm: "EdDSA",
          public_key: JSON.stringify(publicJwk),
          created_at: ctx.now(),
          revoked_at: null,
        })
        .execute();

      return {
        userId,
        keyId,
        algorithm: "EdDSA",
        publicKey: publicJwk as Record<string, unknown>,
        privateKey: privateJwk as Record<string, unknown>,
      };
    },

    revokeUserKey: async ({ actorId, userId, keyId }) => {
      await assertGlobalAdmin(ctx, actorId);
      const res = await db
        .updateTable("user_credentials")
        .set({ revoked_at: ctx.now() })
        .where("key_id", "=", keyId)
        .where("user_id", "=", userId)
        .where("revoked_at", "is", null)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows ?? 0) === 0) throw new NotFoundError("UserCredential", keyId);
    },

    listUserKeys: async ({ actorId, userId }) => {
      await assertGlobalAdmin(ctx, actorId);
      const rows = await db
        .selectFrom("user_credentials")
        .selectAll()
        .where("user_id", "=", userId)
        .orderBy("created_at")
        .execute();
      const items = rows.map((r) =>
        UserCredential.parse({
          id: r.id,
          userId: r.user_id,
          keyId: r.key_id,
          algorithm: r.algorithm,
          createdAt: r.created_at,
          ...(r.revoked_at ? { revokedAt: r.revoked_at } : {}),
        }),
      );
      return { items };
    },
  };
}
