import { z } from "zod";
import { Id, Timestamp } from "./common.js";

// ============================================================
// User credentials (per-user signing keys for JWT auth)
// ============================================================

/** Signature algorithm. EdDSA (Ed25519) only — asymmetric, server holds the public key. */
export const CredentialAlgorithm = z.literal("EdDSA");

/** A JWK (public or private), kept opaque here — jose validates structure on import. */
export const Jwk = z.record(z.unknown());

/**
 * Public, safe-to-read credential metadata. Returned by listUserKeys. Carries
 * NO key material that could sign — only the key id and lifecycle.
 */
export const UserCredential = z.object({
  id: Id,
  userId: Id,
  keyId: z.string().min(1),
  algorithm: CredentialAlgorithm,
  createdAt: Timestamp,
  revokedAt: Timestamp.optional(),
});

/**
 * Returned exactly ONCE at issuance. Carries the PRIVATE key — the secret the
 * user keeps in their client to sign JWTs. Never persisted (the server stores
 * only the public key), never re-readable.
 */
export const IssuedCredential = z.object({
  userId: Id,
  keyId: z.string().min(1),
  algorithm: CredentialAlgorithm,
  publicKey: Jwk,
  privateKey: Jwk,
});

export type CredentialAlgorithm = z.infer<typeof CredentialAlgorithm>;
export type Jwk = z.infer<typeof Jwk>;
export type UserCredential = z.infer<typeof UserCredential>;
export type IssuedCredential = z.infer<typeof IssuedCredential>;
