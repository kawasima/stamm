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
}

/**
 * Verify a `Authorization: Bearer <jwt>` header and return the authenticated
 * actorId (the user id). The flow reads the UNTRUSTED `sub`/`kid` only to look
 * up which stored public key to try (RFC 7515 key-selection); the signature is
 * then verified against that public key, so success proves the caller holds the
 * matching private key. `algorithms: ["EdDSA"]` is pinned to block `alg:none`
 * and HMAC-confusion downgrades. Any failure throws UnauthorizedError.
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
  if (!token) throw new UnauthorizedError("empty bearer token");

  let kid: string | undefined;
  let sub: string | undefined;
  try {
    kid = decodeProtectedHeader(token).kid;
    sub = decodeJwt(token).sub;
  } catch {
    throw new UnauthorizedError("malformed token");
  }
  if (!sub) throw new UnauthorizedError("token missing sub");

  let q = ctx.db
    .selectFrom("user_credentials")
    .select(["public_key", "key_id"])
    .where("user_id", "=", sub)
    .where("revoked_at", "is", null);
  if (kid) q = q.where("key_id", "=", kid);
  const rows = await q.execute();
  if (rows.length === 0) throw new UnauthorizedError("no active key for subject");

  const verifyOpts = {
    algorithms: ["EdDSA"],
    subject: sub,
    clockTolerance: cfg.clockToleranceSec ?? 5,
    ...(cfg.issuer ? { issuer: cfg.issuer } : {}),
    ...(cfg.audience ? { audience: cfg.audience } : {}),
  };

  for (const row of rows) {
    try {
      const key = await importJWK(JSON.parse(row.public_key), "EdDSA");
      await jwtVerify(token, key, verifyOpts);
      return sub;
    } catch {
      // try the next candidate key
    }
  }
  throw new UnauthorizedError("token verification failed");
}
