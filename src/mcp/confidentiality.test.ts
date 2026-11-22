import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createSqlBehaviors } from "../impl/index.js";
import { world, type W } from "../impl/test-world.js";
import type { KeyScope } from "../schema/index.js";
import { SIMPLE_TOOLS } from "./catalog.js";
import { GET, LIST } from "./admin.js";
import { contractArgsObject, type AnyContract } from "./contract.js";
import type { Behaviors } from "./behaviors.js";

const unwrap = (t: z.ZodTypeAny): z.ZodTypeAny => (t instanceof z.ZodOptional || t instanceof z.ZodDefault || t instanceof z.ZodNullable ? unwrap(t._def.innerType) : t);

/** Every way to call a contract that differs in one argument, over all ids there are. */
function* calls(w: W, contract: AnyContract): Generator<Record<string, unknown>> {
  const shape = contractArgsObject(contract).shape as Record<string, z.ZodTypeAny>;
  const some = (k: string, t: z.ZodTypeAny): unknown[] => {
    const inner = unwrap(t);
    if (k === "pagination") return [{ limit: 100 }];
    if (k === "filter") return [{}, ...w.ids.projectId!.map((projectId) => ({ projectId })), ...w.ids.issueId!.map((parentIssueId) => ({ parentIssueId })), ...w.ids.labelId!.map((l) => ({ labelIds: [l] })), { query: "IDDENWOR" }];
    if (k === "include") return [["assignees", "labels", "watchers", "relations", "category", "milestone", "iteration", "parent", "schedule", "estimation", "progress"]];
    if (k === "key") return ["default-1", "default-2", "hidden-project-1"];
    if (k === "identifier") return ["default", "hidden-project"];
    if (k === "targetId") return [...w.ids.issueId!, ...w.ids.commentId!, ...w.ids.projectId!];
    if (k === "targetType") return ["issue", "comment", "project"];
    if (k === "parentIssueId" || k === "relatedIssueId") return w.ids.issueId!;
    if (k === "recipientId" || k === "memberUserId" || k === "ownerId") return w.ids.userId!;
    if (k === "parentProjectId") return w.ids.projectId!;
    if (k === "fromStatusId") return w.ids.statusId!;
    if (w.ids[k]) return w.ids[k]!;
    if (inner instanceof z.ZodEnum) return inner.options;
    if (k === "query" || k === "subject") return ["IDDENWOR", "@secret"];
    return [];
  };
  const names = Object.keys(shape).filter((k) => k !== "actorId");
  const required = names.filter((k) => !shape[k]!.isOptional());
  let bases: Record<string, unknown>[] = [{}];
  for (const k of required) bases = bases.flatMap((o) => some(k, shape[k]!).map((v) => ({ ...o, [k]: v })));
  for (const base of bases) {
    yield base;
    for (const k of names.filter((n) => !required.includes(n))) for (const v of some(k, shape[k]!)) yield { ...base, [k]: v };
  }
}

const READS: [string, keyof Behaviors, AnyContract][] = [
  ...SIMPLE_TOOLS.filter((t) => t.annotations?.readOnlyHint).map((t) => [t.name, t.behavior, t.contract] as [string, keyof Behaviors, AnyContract]),
  ...Object.entries({ get: GET, list: LIST }).flatMap(([op, m]) => Object.entries(m).map(([r, e]) => [`admin_${op}:${r}`, e.behavior, e.contract] as [string, keyof Behaviors, AnyContract])),
];

async function leaks(w: W, b: Behaviors, actorId: string, secrets: string[], own: string[] = []): Promise<string[]> {
  const found = new Set<string>();
  let answered = 0;
  for (const [name, behavior, contract] of READS) {
    for (const args of calls(w, contract)) {
      const given = JSON.stringify(args);
      let refused = false;
      const result = await (b[behavior] as (a: unknown) => Promise<unknown>)({ actorId, ...args }).catch((e: Error) => { refused = true; return e.message; });
      if (!refused) answered++;
      const sent = JSON.stringify(result) ?? "";
      if (refused) for (const s of secrets) if (s && sent.includes(s) && !given.includes(s)) found.add(`${name} error (): ${s}`);
      if (refused) continue;
      for (const s of secrets) if (s && !own.includes(s) && sent.includes(s)) found.add(`${name} (${Object.entries(args).filter(([k]) => k !== "pagination" && k !== "include").map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 14)}`).join(" ")}): ${s.length > 30 ? Object.entries(w.ids).find(([, l]) => l.includes(s))?.[0] ?? "event" : s}`);
    }
  }
  expect(answered).toBeGreaterThan(100);
  return [...found];
}
const summary = (l: string[]) => [...new Set(l.map((x) => x.replace(/ \(.*\): /, " -> ")))].sort();

describe("no read tells", () => {
  it("an outsider anything of a private project or issue, private notes, or other people's things", async () => {
    const w = await world();
    expect(summary(await leaks(w, w.b, w.outsider.id, w.secretFrom.outsider))).toEqual([]);
  });
  it("a member who sees only their own issues anything of the others", async () => {
    const w = await world();
    expect(summary(await leaks(w, w.b, w.limited.id, w.secretFrom.limited))).toEqual([]);
  });
  it("a project-limited key anything of other projects, whoever holds it", async () => {
    const w = await world();
    const scope: KeyScope = { projectIds: [w.pub] };
    const scoped = createSqlBehaviors(w.db, { scope });
    for (const who of [w.insider.id, w.A]) expect(summary(await leaks(w, scoped, who, w.secretFrom.scoped))).toEqual([]);
  });
});
