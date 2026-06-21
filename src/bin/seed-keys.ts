import type { BootstrapResult } from "../impl/bootstrap.js";

export interface SeedKeysIo {
  /**
   * Path to dump the seeded private keys to, or undefined to skip writing.
   * Writing is opt-in (set STAMM_SEED_KEYS_FILE) so the secret never lands on
   * disk by default.
   */
  keysFile?: string;
  /** Persist the dump. The caller is responsible for 0600 file permissions. */
  writeFile: (path: string, data: string) => void;
  /** Emit an operator-facing line (stderr). */
  log: (msg: string) => void;
}

/**
 * Surface the signing keys minted on first boot. Secure by default: the private
 * keys are written to disk ONLY when the operator opts in via
 * STAMM_SEED_KEYS_FILE. Otherwise nothing touches disk — the operator is told
 * how to mint a usable key for the bootstrap admin via the local stdio entry
 * point (`stamm-mcp` runs without JWT, so it can call `user_key_issue`).
 *
 * The private keys themselves are never logged — they would leak into system
 * logs, the exact channel the file's 0600 mode exists to avoid.
 */
export function reportSeedKeys(seed: BootstrapResult, io: SeedKeysIo): void {
  io.log(`bootstrapped a fresh database (admin=${seed.adminId}, member=${seed.memberId}, project=${seed.projectId})`);

  if (io.keysFile) {
    const payload = {
      note: "Seeded signing keys — shown once. Keep these private keys secret; delete this file once distributed.",
      admin: { userId: seed.adminId, keyId: seed.adminKey.keyId, algorithm: seed.adminKey.algorithm, privateKey: seed.adminKey.privateKey },
      member: { userId: seed.memberId, keyId: seed.memberKey.keyId, algorithm: seed.memberKey.algorithm, privateKey: seed.memberKey.privateKey },
    };
    io.writeFile(io.keysFile, JSON.stringify(payload, null, 2));
    io.log(`wrote seeded private keys to ${io.keysFile} (mode 0600) — distribute them, then delete the file.`);
    return;
  }

  io.log("seeded private keys were NOT written to disk (secure default); their secret halves are now discarded.");
  io.log("set STAMM_SEED_KEYS_FILE to opt into a one-time 0600 dump, or mint a key for the bootstrap admin locally:");
  io.log(`  STAMM_ACTOR=${seed.adminId} stamm-mcp   # then call user_key_issue (userId=${seed.adminId})`);
}
