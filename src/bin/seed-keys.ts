import { chmodSync, closeSync, openSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import type { BootstrapResult, SeedKeys } from "../impl/bootstrap.js";

export interface SeedKeysIo {
  /**
   * Value of STAMM_SEED_KEYS_FILE. Writing is opt-in so the secret never lands
   * on disk by default. An empty string is treated as unset, with a warning.
   */
  keysFile?: string;
  /** Database the server runs against; echoed into the stdio recovery command. */
  dbPath: string;
  /** Mint the seed keys. Called only when there is a file to hand them over in. */
  issueKeys: () => Promise<SeedKeys>;
  /** Revoke keys whose private halves could not be handed over. */
  revokeKeys: (keys: SeedKeys) => Promise<void>;
  /** Create the dump file. Must refuse an existing path and leave it 0600 (see writeSecretFile). */
  writeFile: (path: string, data: string) => void;
  /** Emit an operator-facing line (stderr). */
  log: (msg: string) => void;
}

/**
 * Create `path` exclusively and leave it at mode 0600. Refuses an existing
 * file: `mode` on open only applies on creation, so overwriting a 0644 file
 * would keep it world-readable. chmod afterwards so an unusual umask cannot
 * leave it looser or tighter than 0600.
 */
export function writeSecretFile(path: string, data: string): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    chmodSync(path, 0o600);
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
}

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Hand over the signing keys for a freshly bootstrapped database. Secure by
 * default: keys are minted ONLY when the operator opts in via
 * STAMM_SEED_KEYS_FILE, and only kept if the 0600 dump succeeds. Otherwise no
 * key exists, and the operator is told how to mint one for the bootstrap admin
 * over the local stdio entry point (which runs without JWT, so it can call
 * `user_key_issue`).
 *
 * The private keys themselves are never logged — they would leak into system
 * logs, the exact channel the file's 0600 mode exists to avoid.
 */
export async function reportSeedKeys(seed: BootstrapResult, io: SeedKeysIo): Promise<void> {
  io.log(`bootstrapped a fresh database (admin=${seed.adminId}, member=${seed.memberId}, project=${seed.projectId})`);

  if (io.keysFile === "") {
    io.log("warning: STAMM_SEED_KEYS_FILE is set but empty; treating it as unset.");
  }

  if (io.keysFile) {
    const keys = await io.issueKeys();
    const payload = {
      note: "Seeded signing keys — shown once. Keep these private keys secret; delete this file once distributed.",
      admin: { userId: seed.adminId, keyId: keys.adminKey.keyId, algorithm: keys.adminKey.algorithm, privateKey: keys.adminKey.privateKey },
      member: { userId: seed.memberId, keyId: keys.memberKey.keyId, algorithm: keys.memberKey.algorithm, privateKey: keys.memberKey.privateKey },
    };
    try {
      io.writeFile(io.keysFile, JSON.stringify(payload, null, 2));
      io.log(`wrote seeded private keys to ${io.keysFile} — distribute them, then delete the file.`);
      return;
    } catch (err) {
      await io.revokeKeys(keys);
      io.log(`could not write ${io.keysFile} (${err instanceof Error ? err.message : String(err)}); the seeded keys were revoked.`);
    }
  } else {
    io.log("no signing keys were minted (secure default): set STAMM_SEED_KEYS_FILE to get a one-time 0600 dump on a fresh database.");
  }

  io.log("mint a key for the bootstrap admin locally over stdio, from the stamm checkout:");
  io.log(`  STAMM_DB=${shellQuote(resolve(io.dbPath))} STAMM_ACTOR=${seed.adminId} npm run mcp   # then call user_key_issue (userId=${seed.adminId})`);
}
