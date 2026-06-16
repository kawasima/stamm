import { z } from "zod";
import { Id } from "../schema/common.js";
import { IssuedCredential, UserCredential } from "../schema/credential.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// User credential (JWT signing key) management — admin only
// ============================================================

/**
 * Issue a fresh signing keypair for a user. The server stores only the public
 * key; the private key is returned ONCE and never again. Rotation = issue a new
 * key, then revoke the old one after the client has migrated.
 */
export const IssueUserKey = z.function()
  .args(z.object({ actorId: Id, userId: Id }))
  .returns(z.promise(IssuedCredential));

/** Revoke a user's signing key by its key id. Tokens signed with it stop verifying. */
export const RevokeUserKey = z.function()
  .args(z.object({ actorId: Id, userId: Id, keyId: z.string().min(1) }))
  .returns(z.promise(z.void()));

/** List a user's credential metadata (no key material that could sign). */
export const ListUserKeys = z.function()
  .args(z.object({ actorId: Id, userId: Id }))
  .returns(z.promise(PaginatedResult(UserCredential)));
