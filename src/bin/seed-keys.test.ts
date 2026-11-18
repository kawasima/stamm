import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BootstrapResult, SeedKeys } from "../impl/bootstrap.js";
import { reportSeedKeys, writeSecretFile, type SeedKeysIo } from "./seed-keys.js";

const seed: BootstrapResult = {
  adminId: "admin-1",
  memberId: "member-1",
  projectId: "proj-1",
  issueTypeId: "type-1",
  priorityId: "prio-1",
  statusIds: { todo: "s-todo", inProgress: "s-prog", done: "s-done" },
  seeded: true,
};

const keys: SeedKeys = {
  adminKey: { userId: "admin-1", keyId: "ak", algorithm: "EdDSA", scope: {}, publicKey: "ADMIN_PUB" as never, privateKey: "ADMIN_SECRET" as never },
  memberKey: { userId: "member-1", keyId: "mk", algorithm: "EdDSA", scope: {}, publicKey: "MEMBER_PUB" as never, privateKey: "MEMBER_SECRET" as never },
};

function makeIo(overrides: Partial<SeedKeysIo>) {
  const logs: string[] = [];
  const io: SeedKeysIo = {
    keysFile: undefined,
    dbPath: "/srv/stamm/prod.db",
    issueKeys: vi.fn(async () => keys),
    revokeKeys: vi.fn(async () => {}),
    writeFile: vi.fn(),
    log: (m) => logs.push(m),
    ...overrides,
  };
  return { io, logs, out: () => logs.join("\n") };
}

describe("reportSeedKeys — secure-by-default seed key handling", () => {
  it("mints no keys and writes nothing when STAMM_SEED_KEYS_FILE is unset", async () => {
    const { io, out } = makeIo({});
    await reportSeedKeys(seed, io);

    expect(io.issueKeys).not.toHaveBeenCalled();
    expect(io.writeFile).not.toHaveBeenCalled();
    expect(out()).toContain("no signing keys were minted");
    // the recovery command must target the same database the server uses
    expect(out()).toContain("STAMM_DB=/srv/stamm/prod.db STAMM_ACTOR=admin-1 npm run mcp");
    expect(out()).toContain("user_key_issue");
  });

  it("warns on an empty STAMM_SEED_KEYS_FILE and treats it as unset", async () => {
    const { io, out } = makeIo({ keysFile: "" });
    await reportSeedKeys(seed, io);

    expect(io.issueKeys).not.toHaveBeenCalled();
    expect(out()).toContain("set but empty");
  });

  it("quotes a database path that needs it and resolves it to an absolute path", async () => {
    const { io, out } = makeIo({ dbPath: "my db's.db" });
    await reportSeedKeys(seed, io);

    expect(out()).toContain(`STAMM_DB='${resolve("my db")}'\\''s.db'`);
  });

  it("mints and dumps the keys only when opted in, never logging the secrets", async () => {
    const { io, out } = makeIo({ keysFile: "/tmp/keys.json" });
    await reportSeedKeys(seed, io);

    expect(io.issueKeys).toHaveBeenCalledTimes(1);
    expect(io.writeFile).toHaveBeenCalledTimes(1);
    const [path, data] = vi.mocked(io.writeFile).mock.calls[0]!;
    expect(path).toBe("/tmp/keys.json");
    expect(data).toContain("ADMIN_SECRET");
    expect(data).toContain("MEMBER_SECRET");
    expect(io.revokeKeys).not.toHaveBeenCalled();
    expect(out()).toContain("/tmp/keys.json");
    expect(out()).not.toContain("ADMIN_SECRET");
    expect(out()).not.toContain("MEMBER_SECRET");
  });

  it("revokes the keys and prints the stdio fallback when the dump fails", async () => {
    const { io, out } = makeIo({
      keysFile: "/nope/keys.json",
      writeFile: vi.fn(() => { throw new Error("ENOENT"); }),
    });
    await expect(reportSeedKeys(seed, io)).resolves.toBeUndefined();

    expect(io.revokeKeys).toHaveBeenCalledWith(keys);
    expect(out()).toContain("revoked");
    expect(out()).toContain("STAMM_ACTOR=admin-1 npm run mcp");
    expect(out()).not.toContain("ADMIN_SECRET");
  });
});

describe("writeSecretFile", () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("creates the file with mode 0600", () => {
    dir = mkdtempSync(join(tmpdir(), "stamm-seed-"));
    const path = join(dir, "keys.json");
    writeSecretFile(path, "secret");

    expect(readFileSync(path, "utf8")).toBe("secret");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("refuses to overwrite an existing file, leaving it untouched", () => {
    dir = mkdtempSync(join(tmpdir(), "stamm-seed-"));
    const path = join(dir, "keys.json");
    writeFileSync(path, "old", { mode: 0o644 });

    expect(() => writeSecretFile(path, "secret")).toThrow(/EEXIST/);
    expect(readFileSync(path, "utf8")).toBe("old");
  });
});
