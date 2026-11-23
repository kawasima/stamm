import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as B from "../behavior/index.js";
import type { Behaviors } from "../mcp/behaviors.js";
import { SIMPLE_TOOLS } from "../mcp/catalog.js";
import { LIST } from "../mcp/admin.js";
import { contractArgsObject, type AnyContract } from "../mcp/contract.js";
import { createTestDb } from "./test-db.js";
import { createSqlBehaviors } from "./index.js";
import { ensureBootstrapped } from "./bootstrap.js";
import { ForbiddenError, ValidationError } from "./errors.js";

const page = { pagination: { limit: 100 } };

/** Several of everything, with ties, nulls, spaces and letter case in what is sorted by. */
async function world() {
  const db = await createTestDb();
  let clock = Date.parse("2026-03-01T10:00:00.000Z");
  const b = createSqlBehaviors(db, { now: () => new Date(clock).toISOString() });
  const s = (await ensureBootstrapped(b))!;
  const actorId = s.adminId, projectId = s.projectId;
  const role = (await b.listRoles({ actorId, ...page })).items[0]!;
  const prio: string[] = [], type: string[] = [], users: string[] = [], labels: string[] = [], milestones: string[] = [], iterations: string[] = [];
  for (const [i, n] of ["zeta", "Alpha", "mid way", "beta"].entries()) {
    prio.push((await b.createPriority({ actorId, name: n, sortOrder: 3 - i })).id);
    type.push((await b.createIssueType({ actorId, name: n, sortOrder: i % 2 })).id);
    await b.createStatus({ actorId, name: n, category: "todo", sortOrder: 5 + (i % 2) });
    const u = await b.createUser({ actorId, login: `${n.replace(" ", "")}`, email: `${3 - i}@x.io`, displayName: `${n} P${i}%` });
    users.push(u.id);
    await b.addProjectMember({ actorId, projectId, userId: u.id, roleIds: [role.id] });
    labels.push((await b.createLabel({ actorId, projectId, name: `${n}_l`, color: "#000000" })).id);
    await b.createCategory({ actorId, projectId, name: n });
    milestones.push((await b.createMilestone({ actorId, projectId, name: n, sortOrder: i % 2, ...(i % 2 ? { dueDate: `2026-0${i + 1}-01` } : {}) })).id);
    iterations.push((await b.createIteration({ actorId, projectId, name: n, sortOrder: i % 2, startDate: `2026-0${4 - i}-01`, endDate: `2026-0${4 - i}-14` })).id);
    await b.createRole({ actorId, name: n, permissions: [], issuesVisibility: "all" });
    const g = await b.createUserGroup({ actorId, name: n });
    await b.addGroupMember({ actorId, groupId: g.id, userId: u.id });
    await b.createDraftIssue({ actorId, projectId, title: n, sortOrder: 4 - i });
    await b.createIssueTemplate({ actorId, projectId, name: n, descriptionTemplate: "x", sortOrder: 4 - i, issueTypeId: type[0]! });
    await b.createProjectView({ actorId, projectId, ownerId: actorId, name: n, filter: {}, visibility: "public", sortOrder: 4 - i });
    await b.createProject({ actorId, identifier: `p${3 - i}`, name: n, parentProjectId: projectId });
    await b.createCustomFieldDefinition({ actorId, name: n, fieldType: i % 2 ? "integer" : "multi_list", possibleValues: ["a", "b"], constraints: {}, scope: {}, sortOrder: 4 - i });
  }
  const gid = (await b.listUserGroups({ actorId, ...page })).items[0]!.id;
  for (const u of users) await b.addGroupMember({ actorId, groupId: gid, userId: u }).catch(() => undefined);
  const issues: string[] = [];
  for (let i = 0; i < 7; i++) {
    clock += (i % 3) * 43_200_000; // some share an instant, some fall on another day
    const it = await b.createIssue({
      actorId, projectId, issueTypeId: type[i % 4]!, priorityId: prio[i % 4]!, subject: ["b two words", "B one", "a  x", "a", "c 100%", "c_1", "z"][i]!,
      ...(i % 2 ? { dueDate: `2026-04-0${i}` } : {}), assigneeIds: i % 3 ? [users[i % 4]!, users[(i + 1) % 4]!] : [], estimatedHours: i,
      ...(i > 4 ? { statusId: s.statusIds.done } : {}), labelIds: [labels[i % 4]!], milestoneId: milestones[i % 4]!,
    });
    issues.push(it.id);
    await b.createComment({ actorId, issueId: issues[0]!, body: `c${i}` });
    await b.createTimeEntry({ actorId, projectId, issueId: it.id, userId: users[i % 4]!, activityId: "dev", hours: (i % 3) + 0.5, spentOn: `2026-03-0${(i % 2) + 1}` });
    await b.createAttachment({ actorId, targetType: "issue", targetId: issues[0]!, filename: `f${i}`, contentType: "text/plain", sizeBytes: 1, storageKey: `k${i}` });
    if (i > 0) {
      await b.createIssueRelation({ actorId, issueId: issues[0]!, relatedIssueId: it.id, relationType: "relates_to" });
      await b.setIssueParent({ actorId, childIssueId: it.id, parentIssueId: issues[0]! });
      await b.setIssueSchedule({ actorId, issueId: issues[0]!, dueDate: `2026-05-0${i}` });
      await b.setIssueEstimation({ actorId, issueId: issues[0]!, estimatedHours: 10 + i });
      await b.transitionIssueStatus({ actorId, issueId: issues[0]!, toStatusId: i % 2 ? s.statusIds.done : s.statusIds.todo });
    }
    await b.setIssueAssignees({ actorId, issueId: it.id, assigneeIds: [users[0]!] }).then(() => b.setIssueAssignees({ actorId, issueId: it.id, assigneeIds: i % 3 ? [users[i % 4]!] : [] }));
  }
  const fields = (await b.listCustomFieldDefinitions({ actorId, ...page })).items;
  return { db, b, s, actorId, projectId, prio, type, users, labels, milestones, iterations, issues, role, gid, fields };
}
type W = Awaited<ReturnType<typeof world>>;

const issueFilter = (w: W): Record<string, unknown> => ({
  projectId: w.projectId, projectIds: [w.projectId], issueTypeIds: w.type, statusIds: [w.s.statusIds.todo], statusCategories: ["todo"], priorityIds: w.prio, assigneeIds: w.users,
  authorId: w.actorId, labelIds: w.labels, milestoneId: w.milestones[0], iterationId: w.iterations[0], categoryId: "c", parentIssueId: w.issues[0], watcherUserId: w.users[0], visibility: "public",
  createdAfter: "2026-01-01", createdBefore: "2026-12-31", updatedAfter: "2026-01-01", updatedBefore: "2026-12-31", dueDateFrom: "2026-01-01", dueDateTo: "2026-12-31",
  hasNoDueDate: false, isOverdue: false, customField: { fieldId: "f", value: "x" }, query: "a",
});

/** A value for every argument a listing can take, by name. */
const values = (w: W): Record<string, unknown> => ({
  actorId: w.actorId, projectId: w.projectId, issueId: w.issues[0], parentIssueId: w.issues[0], groupId: w.gid, targetType: "issue", targetId: w.issues[0],
  issueTypeId: w.type[0], roleId: w.role.id, recipientId: w.users[0], userId: w.users[0], fromStatusId: w.s.statusIds.todo, activityId: "dev",
  status: "active", kind: "regular", query: "a", category: "todo", visibility: "public", lifecycle: "active", layout: "table", fieldType: "integer", relationType: "relates_to",
  eventType: "issue.assigned", isRead: false, action: "created", parentProjectId: w.projectId, memberUserId: w.s.memberId,
  occurredAfter: "2026-01-01", occurredBefore: "2026-12-31", occurredFrom: "2026-01-01T00:00:00Z", occurredUntil: "2027-01-01T00:00:00Z", kinds: ["status"],
  spentOnFrom: "2026-01-01", spentOnTo: "2026-12-31", groupBy: "user", include: ["labels"], sortDirection: "asc", pagination: { limit: 100 },
  filter: issueFilter(w), issues: issueFilter(w), authorIds: w.users,
});

const LISTINGS: [string, keyof Behaviors, AnyContract][] = [
  ...SIMPLE_TOOLS.filter((t) => t.annotations?.readOnlyHint && contractArgsObject(t.contract).shape.pagination).map((t) => [t.name, t.behavior, t.contract] as [string, keyof Behaviors, AnyContract]),
  ...Object.entries(LIST).map(([r, e]) => [`admin_list:${r}`, e.behavior, e.contract] as [string, keyof Behaviors, AnyContract]),
];
const shapeOf = (c: AnyContract) => contractArgsObject(c).shape as Record<string, z.ZodTypeAny>;
const unwrap = (t: z.ZodTypeAny): z.ZodTypeAny => (t instanceof z.ZodOptional || t instanceof z.ZodDefault || t instanceof z.ZodNullable ? unwrap(t._def.innerType) : t);

/** Arguments that take an issue filter. */
const FILTERS = ["filter", "issues"];
/** Arguments of which exactly one is given, by listing. */
const ONE_OF: Record<string, string[]> = { comment_list: ["issueId", "issues"] };
/** The ways to call a listing as far as those go: which arguments to leave out. */
const leavings = (name: string): string[][] => (ONE_OF[name] ?? [""]).map((kept) => (ONE_OF[name] ?? []).filter((k) => k !== kept));

/** Only what a listing requires. */
const required = (w: W, name: string, c: AnyContract): Record<string, unknown> => ({
  ...(ONE_OF[name] ? { [ONE_OF[name]!.at(-1)!]: {} } : {}),
  ...Object.fromEntries(Object.entries(shapeOf(c)).filter(([k, t]) => !t.isOptional() || k === "sortDirection").filter(([k]) => k !== "pagination" && k !== "sortDirection").map(([k]) => [k, k === "filter" ? {} : values(w)[k]])),
});

describe("every listing", () => {
  it("is covered by a value for each argument it declares", async () => {
    const v = values(await world());
    for (const [name, , c] of LISTINGS) for (const k of Object.keys(shapeOf(c))) if (k !== "sortBy") expect(v, `${name}.${k}`).toHaveProperty(k);
    expect(Object.keys(v.filter as object).sort()).toEqual(Object.keys((unwrap(shapeOf(B.ListIssues as never).filter!) as z.ZodObject<z.ZodRawShape>).shape).sort());
  });

  // Unused parameters that are destructured are the compiler's to find (noUnusedParameters).
  it("reads every argument it declares", async () => {
    const w = await world();
    for (const [name, behavior, c] of LISTINGS) {
      const read = new Set<string>();
      const watch = (o: object, path: string): object => new Proxy(o, {
        get: (t, k: string) => {
          if (typeof k === "string") read.add(path + k);
          const v = (t as Record<string, unknown>)[k];
          return FILTERS.includes(k) && v ? watch(v as object, `${k}.`) : v;
        },
      });
      const shape = shapeOf(c);
      const args = Object.fromEntries(Object.keys(shape).map((k) => [k, k === "sortBy" ? (unwrap(shape[k]!) as z.ZodEnum<[string]>).options[0] : values(w)[k]]));
      for (const out of leavings(name)) await (w.b[behavior] as (a: unknown) => Promise<unknown>)(watch(Object.fromEntries(Object.entries(args).filter(([k]) => !out.includes(k))), ""));
      const declared = Object.keys(shape).flatMap((k) => (FILTERS.includes(k) ? Object.keys(issueFilter(w)).map((f) => `${k}.${f}`) : [k]));
      // Shared vocabulary is the same for every reader, so the actor may go unread.
      expect(declared.filter((k) => k !== "actorId" && !read.has(k)), name).toEqual([]);
    }
  });

  it("pages through exactly what it lists at once, in every order, and refuses another order's cursor", async () => {
    const w = await world();
    let walked = 0;
    for (const [name, behavior, c] of LISTINGS) {
      const list = w.b[behavior] as (a: unknown) => Promise<{ items: { id: string }[]; nextCursor?: string }>;
      const shape = shapeOf(c);
      const sorts = shape.sortBy ? (unwrap(shape.sortBy) as z.ZodEnum<[string, ...string[]]>).options : [undefined];
      const dirs = shape.sortDirection ? ["asc", "desc"] : [undefined];
      let foreign: string | undefined;
      for (const sortBy of sorts) for (const sortDirection of dirs) {
        const label = `${name} ${sortBy ?? ""} ${sortDirection ?? ""}`;
        const args = { ...required(w, name, c), ...(sortBy ? { sortBy } : {}), ...(sortDirection ? { sortDirection } : {}) };
        const all = (await list({ ...args, pagination: { limit: 100 } })).items.map((i) => i.id);
        const got: string[] = [];
        let cursor: string | undefined, first: string | undefined;
        do {
          const r = await list({ ...args, pagination: { limit: 2, ...(cursor ? { cursor } : {}) } });
          got.push(...r.items.map((i) => i.id));
          cursor = r.nextCursor;
          first ??= cursor;
          if (got.length > 500) throw new Error(`${label} does not end`);
        } while (cursor);
        expect(got, label).toEqual(all);
        expect(new Set(all).size, label).toBe(all.length);
        if (all.length > 2) walked++;
        if (foreign && first) await expect(list({ ...args, pagination: { limit: 2, cursor: foreign } }), label).rejects.toBeInstanceOf(ValidationError);
        foreign = first ?? foreign;
        if (all.length > 2) for (const bad of ["x", Buffer.from("null").toString("base64url"), Buffer.from('["a"]').toString("base64url")]) {
          await expect(list({ ...args, pagination: { limit: 2, cursor: bad } }), `${label} ${bad}`).rejects.toBeInstanceOf(ValidationError);
        }
      }
    }
    expect(walked).toBeGreaterThan(50);
  });

  it("sorts opposite ways for asc and desc, apart from what has no value", async () => {
    const w = await world();
    const subj = async (sortBy: "subject" | "priority" | "status" | "issueType" | "assignee" | "dueDate" | "number" | "createdAt", sortDirection: "asc" | "desc") =>
      (await w.b.listIssues({ actorId: w.actorId, filter: { projectId: w.projectId }, include: ["assignees", "schedule"], sortBy, sortDirection, ...page })).items;
    expect((await subj("subject", "asc")).map((i) => i.subject)).toEqual(["a", "a  x", "B one", "b two words", "c 100%", "c_1", "z"]);
    expect((await subj("number", "desc")).map((i) => i.number)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    const order = new Map((await w.b.listPriorities({ actorId: w.actorId, ...page })).items.map((p) => [p.id, p.sortOrder]));
    const ranks = (await subj("priority", "asc")).map((i) => order.get(i.priorityId)!);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect((await subj("priority", "desc")).map((i) => order.get(i.priorityId)!)).toEqual([...ranks].reverse());
    const st = new Map((await w.b.listStatuses({ actorId: w.actorId, ...page })).items.map((x) => [x.id, x.sortOrder]));
    const sr = (await subj("status", "desc")).map((i) => st.get(i.statusId)!);
    expect(sr).toEqual([...sr].sort((a, b) => b - a));
    for (const dir of ["asc", "desc"] as const) {
      const people = (await subj("assignee", dir)).map((i) => i.assignees![0]?.displayName.toLowerCase());
      const named = people.filter((p) => p !== undefined) as string[];
      expect(people.slice(0, named.length)).toEqual([...named].sort((a, b) => (dir === "asc" ? 1 : -1) * (a < b ? -1 : a > b ? 1 : 0)));
      const due = (await subj("dueDate", dir)).map((i) => i.schedule?.dueDate);
      expect(due.slice(due.findIndex((d) => d === undefined)).every((d) => d === undefined)).toBe(true);
    }
  });
});

describe("sorting by a field", () => {
  it("is by that field, either way, with rows that lack it last", async () => {
    const w = await world();
    const a = { actorId: w.actorId, projectId: w.projectId, ...page };
    const cases: Record<string, [string[], (sortBy: never, sortDirection: "asc" | "desc") => Promise<{ items: Record<string, unknown>[] }>]> = {
      milestones: [["name", "dueDate", "sortOrder"], (sortBy, sortDirection) => w.b.listMilestones({ ...a, sortBy, sortDirection })],
      iterations: [["name", "startDate", "sortOrder"], (sortBy, sortDirection) => w.b.listIterations({ ...a, sortBy, sortDirection })],
      projects: [["name", "identifier"], (sortBy, sortDirection) => w.b.listProjects({ actorId: w.actorId, sortBy, sortDirection, ...page })],
      users: [["login", "displayName", "email"], (sortBy, sortDirection) => w.b.listUsers({ actorId: w.actorId, sortBy, sortDirection, ...page })],
      time: [["hours", "spentOn", "occurredAt"], (sortBy, sortDirection) => w.b.listTimeEntries({ actorId: w.actorId, sortBy, sortDirection, ...page })],
    };
    for (const [name, [fields, list]] of Object.entries(cases)) for (const f of fields) for (const dir of ["asc", "desc"] as const) {
      const got = (await list(f as never, dir)).items.map((i) => (typeof i[f] === "string" ? (i[f] as string).toLowerCase() : (i[f] as number | undefined)));
      const has = got.filter((v) => v !== undefined);
      expect(new Set(has).size, `${name} ${f}`).toBeGreaterThan(1);
      const sorted = [...has].sort((x, y) => (dir === "asc" ? 1 : -1) * (x! < y! ? -1 : x! > y! ? 1 : 0));
      expect(got, `${name} ${f} ${dir}`).toEqual([...sorted, ...got.filter((v) => v === undefined)]);
    }
  });
});

describe("filters", () => {
  it("take bounds as whole days, both ends included", async () => {
    const w = await world();
    const all = (await w.b.listIssues({ actorId: w.actorId, filter: {}, ...page })).items.length;
    const days = new Map<string, number>();
    for (const e of (await w.b.listActivities({ actorId: w.actorId, action: "created", targetType: "issue", ...page })).items) days.set(e.occurredAt.slice(0, 10), (days.get(e.occurredAt.slice(0, 10)) ?? 0) + 1);
    expect(days.size).toBeGreaterThan(2);
    let sum = 0;
    for (const [day, n] of days) {
      const got = (await w.b.listIssues({ actorId: w.actorId, filter: { createdAfter: day, createdBefore: day }, ...page })).items.length;
      expect(got).toBe(n);
      expect((await w.b.listActivities({ actorId: w.actorId, action: "created", occurredAfter: day, occurredBefore: day, ...page })).items).toHaveLength(n);
      sum += got;
    }
    expect(sum).toBe(all);
    const latest = [...days.keys()].sort().at(-1)!;
    expect((await w.b.listIssues({ actorId: w.actorId, filter: { updatedBefore: latest }, ...page })).items).toHaveLength(all);
  });

  it("match text literally", async () => {
    const w = await world();
    const find = async (query: string) => (await w.b.listIssues({ actorId: w.actorId, filter: { query }, ...page })).items.map((i) => i.subject);
    expect(await find("%")).toEqual(["c 100%"]);
    expect(await find("_")).toEqual(["c_1"]);
    expect(await find("\\")).toEqual([]);
    expect((await find("TWO"))).toEqual(["b two words"]);
    expect((await w.b.listLabels({ actorId: w.actorId, projectId: w.projectId, query: "LPHA", ...page })).items.map((l) => l.name)).toEqual(["Alpha_l"]);
    expect((await w.b.listProjects({ actorId: w.actorId, query: "%", ...page })).items).toEqual([]);
  });

  it("match a custom field by value and type, alone or among several", async () => {
    const w = await world();
    const int = w.fields.find((f) => f.fieldType === "integer")!.id, multi = w.fields.find((f) => f.fieldType === "multi_list")!.id;
    const text = (await w.b.createCustomFieldDefinition({ actorId: w.actorId, name: "t", fieldType: "string", constraints: {}, scope: {} })).id;
    const bool = (await w.b.createCustomFieldDefinition({ actorId: w.actorId, name: "b", fieldType: "boolean", constraints: {}, scope: {} })).id;
    await w.b.updateIssue({ actorId: w.actorId, issueId: w.issues[0]!, customFields: [{ fieldId: int, value: 1 }, { fieldId: multi, value: ["a", "b"] }, { fieldId: bool, value: true }] });
    await w.b.updateIssue({ actorId: w.actorId, issueId: w.issues[1]!, customFields: [{ fieldId: text, value: "1" }, { fieldId: bool, value: false }, { fieldId: multi, value: ["b"] }] });
    const find = async (fieldId: string, value: string | number | boolean) => (await w.b.listIssues({ actorId: w.actorId, filter: { customField: { fieldId, value } }, ...page })).items.map((i) => w.issues.indexOf(i.id));
    expect(await find(int, 1)).toEqual([0]);
    expect(await find(int, "1")).toEqual([]);
    expect(await find(text, "1")).toEqual([1]);
    expect(await find(text, 1)).toEqual([]);
    expect(await find(bool, true)).toEqual([0]);
    expect(await find(bool, false)).toEqual([1]);
    expect(await find(multi, "a")).toEqual([0]);
    expect(await find(multi, "b")).toEqual([0, 1]);
    expect(await find("other", "1")).toEqual([]);
  });

  it("narrow the directory, without letting an address be found by those who can't see it", async () => {
    const w = await world();
    const users = async (over: object, actorId = w.actorId) => (await w.b.listUsers({ actorId, ...over, ...page })).items.map((u) => u.login);
    expect(await users({ kind: "admin" })).toEqual(["admin"]);
    await w.b.setUserStatus({ actorId: w.actorId, userId: w.users[0]!, status: "inactive" });
    expect(await users({ status: "inactive" })).toEqual(["zeta"]);
    expect(await users({ status: "active" })).not.toContain("zeta");
    expect(await users({ query: "MID WAY" })).toEqual(["midway"]);
    expect(await users({ query: "@x.io", sortBy: "email" })).toEqual(["beta", "midway", "Alpha", "zeta"]);
    expect(await users({ query: "@x.io" }, w.users[1]!)).toEqual([]);
    await expect(users({ sortBy: "email" }, w.users[1]!)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await w.b.listStatuses({ actorId: w.actorId, category: "done", ...page })).items.map((x) => x.name)).toEqual(["Done"]);
  });
});

describe("what someone put in order", () => {
  it("is listed in it", async () => {
    const w = await world();
    const a = { actorId: w.actorId, projectId: w.projectId, ...page };
    const orders = async (items: Promise<{ items: { sortOrder: number }[] }>) => (await items).items.map((i) => i.sortOrder);
    for (const [name, o] of Object.entries({
      statuses: await orders(w.b.listStatuses({ actorId: w.actorId, ...page })), priorities: await orders(w.b.listPriorities({ actorId: w.actorId, ...page })), types: await orders(w.b.listIssueTypes({ actorId: w.actorId, ...page })),
      milestones: await orders(w.b.listMilestones(a)), iterations: await orders(w.b.listIterations(a)), drafts: await orders(w.b.listDraftIssues(a)), templates: await orders(w.b.listIssueTemplates(a)),
      views: await orders(w.b.listProjectViews(a)), fields: await orders(w.b.listCustomFieldDefinitions(a)),
    })) expect(o, name).toEqual([...o].sort((x, y) => x - y));
  });

  it("is notifications newest first", async () => {
    const w = await world();
    const at = (await w.b.listNotifications({ actorId: w.actorId, recipientId: w.users[0]!, ...page })).items.map((n) => n.occurredAt);
    expect(at.length).toBeGreaterThan(2);
    expect(at).toEqual([...at].sort().reverse());
  });
});

describe("writing configuration", () => {
  it("keeps every field its contract takes", async () => {
    const { CREATE, UPDATE } = await import("../mcp/admin.js");
    for (const [op, map] of [["create", CREATE], ["update", UPDATE]] as const) {
      for (const [resource, e] of Object.entries(map)) {
        const kept = Object.keys(((e.contract.returnType() as z.ZodPromise<z.ZodObject<z.ZodRawShape>>)._def.type).shape);
        const taken = Object.keys(contractArgsObject(e.contract).shape).filter((k) => k !== "actorId" && !(op === "update" && k.endsWith("Id")));
        expect(taken.filter((k) => !kept.includes(k)), `${op} ${resource}`).toEqual([]);
      }
    }
  });
});
