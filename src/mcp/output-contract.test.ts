import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SIMPLE_TOOLS } from "./catalog.js";
import { CREATE, DELETE, GET, LIST, UPDATE } from "./admin.js";
import { contractReturn, declaredResult } from "./contract.js";
import { connect, stubBehaviors } from "./test-helpers.js";
import { createTestDb } from "../impl/test-db.js";
import { createSqlBehaviors } from "../impl/index.js";
import { ensureBootstrapped } from "../impl/bootstrap.js";
import { NotFoundError } from "../impl/errors.js";

const TOOLS = [
  ...SIMPLE_TOOLS.map((t) => [t.name, t.contract] as const),
  ...Object.entries({ create: CREATE, get: GET, update: UPDATE, delete: DELETE, list: LIST }).flatMap(([op, map]) =>
    Object.entries(map).map(([r, e]) => [`admin_${op}:${r}`, e.contract] as const)),
];

/** Whether a field of this name can appear anywhere in values of the schema. */
function mentions(schema: z.ZodTypeAny, field: string): boolean {
  if (schema instanceof z.ZodObject) return Object.entries(schema.shape).some(([k, v]) => k === field || mentions(v as z.ZodTypeAny, field));
  if (schema instanceof z.ZodArray) return mentions(schema.element, field);
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return mentions(schema.unwrap(), field);
  if (schema instanceof z.ZodDefault) return mentions(schema.removeDefault(), field);
  if (schema instanceof z.ZodEffects) return mentions(schema.innerType(), field);
  if (schema instanceof z.ZodUnion) return schema.options.some((o: z.ZodTypeAny) => mentions(o, field));
  if (schema instanceof z.ZodDiscriminatedUnion) return [...schema.options.values()].some((o) => mentions(o as z.ZodTypeAny, field));
  if (schema instanceof z.ZodRecord) return mentions(schema.valueSchema, field);
  return false;
}

describe("what tools may send", () => {
  it("an email only from a user looked up as a user", () => {
    expect(TOOLS.filter(([, c]) => mentions(contractReturn(c), "email")).map(([n]) => n).sort()).toEqual([
      "admin_create:user", "admin_get:user", "admin_list:user", "admin_update:user", "group_members",
    ]);
  });

  it("is what the contract declares, whatever the behavior returned", async () => {
    const comment = { id: "c", occurredAt: "2026-01-01T00:00:00.000Z", issueId: "i", authorId: "u", body: "hi", visibility: "public" };
    const client = await connect(stubBehaviors({ getComment: async () => ({ ...comment, secret: "leak" }) as never }));
    const res = await client.callTool({ name: "comment_get", arguments: { actorId: "u", commentId: "c" } });
    expect(res.structuredContent).toEqual(comment);
    expect(JSON.stringify(res)).not.toContain("leak");
  });

  it("is nothing when the result does not fit the contract", async () => {
    const client = await connect(stubBehaviors({ getComment: async () => ({ id: "c", secret: "leak" }) as never }));
    const res = await client.callTool({ name: "comment_get", arguments: { actorId: "u", commentId: "c" } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res)).not.toContain("leak");
  });

  it("keeps the difference between a missing result and none declared", () => {
    expect(declaredResult(SIMPLE_TOOLS.find((t) => t.name === "project_get_by_identifier")!.contract, null)).toBeNull();
    expect(declaredResult(SIMPLE_TOOLS.find((t) => t.name === "issue_delete")!.contract, undefined)).toBeUndefined();
  });
});

describe("people on an issue", () => {
  it("are shown without their email to everyone, through every read of it", async () => {
    const b = createSqlBehaviors(await createTestDb());
    const s = (await ensureBootstrapped(b))!;
    const i = await b.createIssue({ actorId: s.adminId, projectId: s.projectId, issueTypeId: s.issueTypeId, priorityId: s.priorityId, subject: "x", assigneeIds: [s.memberId] });
    await b.watchIssue({ actorId: s.memberId, issueId: i.id });
    for (const actorId of [s.adminId, s.memberId]) {
      const row = (await b.listIssues({ actorId, filter: {}, include: ["assignees", "watchers"], pagination: { limit: 5 } })).items[0]!;
      const detail = await b.getIssueDetail({ actorId, issueId: i.id });
      for (const u of [...row.assignees!, ...row.watchers!, ...detail.assignees, ...detail.watchers]) {
        expect(u).toMatchObject({ login: "member", displayName: "Member" });
        expect(u).not.toHaveProperty("email");
      }
    }
  });
});

describe("a project without a visibility", () => {
  it("is not public: its issues, configuration and activity stay hidden from non-members", async () => {
    const db = await createTestDb();
    const b = createSqlBehaviors(db);
    const s = (await ensureBootstrapped(b))!;
    const out = await b.createUser({ actorId: s.adminId, login: "out", email: "o@x.io", displayName: "O" });
    const i = await b.createIssue({ actorId: s.adminId, projectId: s.projectId, issueTypeId: s.issueTypeId, priorityId: s.priorityId, subject: "x" });
    expect((await b.listIssues({ actorId: out.id, filter: {}, pagination: { limit: 5 } })).items).toHaveLength(1);
    await db.deleteFrom("project_categories").execute();
    expect((await b.listIssues({ actorId: out.id, filter: {}, pagination: { limit: 5 } })).items).toEqual([]);
    expect((await b.listActivities({ actorId: out.id, pagination: { limit: 5 } })).items).toEqual([]);
    for (const read of [
      () => b.getIssue({ actorId: out.id, issueId: i.id }), () => b.getIssueDetail({ actorId: out.id, issueId: i.id }),
      () => b.listComments({ actorId: out.id, issueId: i.id, pagination: { limit: 5 } }), () => b.getProject({ actorId: out.id, projectId: s.projectId }),
      () => b.listLabels({ actorId: out.id, projectId: s.projectId, pagination: { limit: 5 } }), () => b.listIssueStatusHistory({ actorId: out.id, issueId: i.id, pagination: { limit: 5 } }),
    ]) await expect(read()).rejects.toBeInstanceOf(NotFoundError);
  });
});
