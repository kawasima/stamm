import { importJWK, jwtVerify, decodeProtectedHeader, decodeJwt } from "jose";
import type { Ctx } from "../impl/ctx.js";
import { UnauthorizedError } from "../impl/errors.js";

export interface AuthConfig {
  /** Optional expected `iss` claim. */
  issuer?: string;
  /** Optional expected `aud` claim. */
  audience?: string;
  /** Clock skew tolerance in seconds (default 5). */
  clockToleranceSec?: number;
  /** Hard cap on token age in seconds (requires `iat`). Defaults to 15 minutes. */
  maxTokenAgeSec?: number;
}

const DEFAULT_MAX_TOKEN_AGE_SEC = 15 * 60;

/** A single generic failure message — never distinguishes "no such user/key"
 *  from "bad signature" so the endpoint can't be used to enumerate accounts. */
const INVALID = "invalid or expired token";

/**
 * Verify a `Authorization: Bearer <jwt>` header and return the authenticated
 * actorId (the user id). The flow reads the UNTRUSTED `sub`/`kid` only to look
 * up which stored public key to try (RFC 7515 key-selection); the signature is
 * then verified against that public key, so success proves the caller holds the
 * matching private key. Hardening:
 *   - `algorithms: ["EdDSA"]` blocks `alg:none` and HMAC-confusion downgrades.
 *   - `exp` is REQUIRED and a `maxTokenAge` caps lifetime, so a token can't live
 *     forever even if the client omits/inflates `exp`.
 *   - after the signature checks out, the account must still exist and be active,
 *     so deleting or deactivating a user invalidates their outstanding tokens.
 * Any failure throws UnauthorizedError.
 */
export async function authenticate(
  ctx: Ctx,
  authorizationHeader: string | undefined,
  cfg: AuthConfig = {},
): Promise<string> {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    throw new UnauthorizedError("missing bearer token");
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) throw new UnauthorizedError("missing bearer token");

  let kid: string | undefined;
  let sub: string | undefined;
  let exp: number | undefined;
  try {
    kid = decodeProtectedHeader(token).kid;
    const claims = decodeJwt(token);
    sub = claims.sub;
    exp = claims.exp;
  } catch {
    throw new UnauthorizedError("malformed token");
  }
  if (!sub) throw new UnauthorizedError(INVALID);
  if (typeof exp !== "number") throw new UnauthorizedError(INVALID); // never-expiring tokens are rejected

  let q = ctx.db
    .selectFrom("user_credentials")
    .select(["public_key", "key_id"])
    .where("user_id", "=", sub)
    .where("revoked_at", "is", null);
  if (kid) q = q.where("key_id", "=", kid);
  const rows = await q.execute();
  if (rows.length === 0) throw new UnauthorizedError(INVALID);

  const verifyOpts = {
    algorithms: ["EdDSA"],
    subject: sub,
    clockTolerance: cfg.clockToleranceSec ?? 5,
    maxTokenAge: cfg.maxTokenAgeSec ?? DEFAULT_MAX_TOKEN_AGE_SEC,
    ...(cfg.issuer ? { issuer: cfg.issuer } : {}),
    ...(cfg.audience ? { audience: cfg.audience } : {}),
  };

  for (const row of rows) {
    try {
      const key = await importJWK(JSON.parse(row.public_key), "EdDSA");
      await jwtVerify(token, key, verifyOpts);
    } catch {
      continue; // try the next candidate key
    }
    // Signature is valid → `sub` is proven. The account must still be usable.
    await assertAccountActive(ctx, sub);
    return sub;
  }
  throw new UnauthorizedError(INVALID);
}

/** Reject tokens for a user that has been deleted or deactivated since signing. */
async function assertAccountActive(ctx: Ctx, userId: string): Promise<void> {
  const user = await ctx.db.selectFrom("users").select("id").where("id", "=", userId).executeTakeFirst();
  if (!user) throw new UnauthorizedError(INVALID);
  const status = await ctx.db
    .selectFrom("user_statuses")
    .select("status")
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (status && status.status !== "active") throw new UnauthorizedError(INVALID);
}
