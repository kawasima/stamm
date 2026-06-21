import { describe, it, expect, vi } from "vitest";
import type { BootstrapResult } from "../impl/bootstrap.js";
import { reportSeedKeys } from "./seed-keys.js";

const seed: BootstrapResult = {
  adminId: "admin-1",
  memberId: "member-1",
  projectId: "proj-1",
  issueTypeId: "type-1",
  priorityId: "prio-1",
  statusIds: { todo: "s-todo", inProgress: "s-prog", done: "s-done" },
  adminKey: { userId: "admin-1", keyId: "ak", algorithm: "EdDSA", publicKey: "ADMIN_PUB" as never, privateKey: "ADMIN_SECRET" as never },
  memberKey: { userId: "member-1", keyId: "mk", algorithm: "EdDSA", publicKey: "MEMBER_PUB" as never, privateKey: "MEMBER_SECRET" as never },
  seeded: true,
};

describe("reportSeedKeys — secure-by-default seed key handling", () => {
  it("never writes to disk when STAMM_SEED_KEYS_FILE is unset", () => {
    const writeFile = vi.fn();
    const logs: string[] = [];
    reportSeedKeys(seed, { keysFile: undefined, writeFile, log: (m) => logs.push(m) });

    expect(writeFile).not.toHaveBeenCalled();
    const out = logs.join("\n");
    expect(out).toContain("NOT written to disk");
    expect(out).toContain("admin-1");
    expect(out).toContain("user_key_issue");
    // private keys must never reach the log (would leak into system logs)
    expect(out).not.toContain("ADMIN_SECRET");
    expect(out).not.toContain("MEMBER_SECRET");
  });

  it("writes a dump containing the private keys only when opted in", () => {
    const writeFile = vi.fn();
    const logs: string[] = [];
    reportSeedKeys(seed, { keysFile: "/tmp/keys.json", writeFile, log: (m) => logs.push(m) });

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, data] = writeFile.mock.calls[0] as [string, string];
    expect(path).toBe("/tmp/keys.json");
    expect(data).toContain("ADMIN_SECRET");
    expect(data).toContain("MEMBER_SECRET");
    expect(logs.join("\n")).toContain("/tmp/keys.json");
  });
});
