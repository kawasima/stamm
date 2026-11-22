import { describe, expect, it } from "vitest";
import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import type { Database } from "./db/schema.js";
import { migrateToLatest } from "./db/migrate.js";
import { createSqlBehaviors } from "./index.js";
import { world, type W } from "./test-world.js";
import { SIMPLE_TOOLS } from "../mcp/catalog.js";
import { CREATE, DELETE, UPDATE } from "../mcp/admin.js";
import type { Behaviors } from "../mcp/behaviors.js";

/** Every behavior a client can write through: the tools, and what issue_update is made of. */
const WRITES = [...new Set<keyof Behaviors>([
  ...SIMPLE_TOOLS.filter((t) => !t.annotations?.readOnlyHint).map((t) => t.behavior),
  ...[CREATE, UPDATE, DELETE].flatMap((m) => Object.values(m).map((e) => e.behavior)),
  "updateIssue", "setIssueAssignees", "setIssueLabels", "setIssueCategory", "setIssueMilestone", "setIssueParent", "setIssueIteration", "setIssueSchedule", "setIssueEstimation", "setIssueProgress",
])];

/** Arguments with which each write succeeds for the insider or the admin. */
async function validArgs(w: W, issueId: string): Promise<Partial<Record<keyof Behaviors, Record<string, unknown>>>> {
  const { b, A, s, pub, ids } = w;
  const I = w.insider.id, id = (k: string, n = 0) => ids[k]![n]!;
  const spare = {
    user: await b.createUser({ actorId: A, login: "spare", email: "spare@x.io", displayName: "S" }),
    status: await b.createStatus({ actorId: A, name: "spare", category: "todo", sortOrder: 9 }),
    priority: await b.createPriority({ actorId: A, name: "spare" }),
    type: await b.createIssueType({ actorId: A, name: "spare" }),
    role: await b.createRole({ actorId: A, name: "spare", permissions: [], issuesVisibility: "all" }),
    group: await b.createUserGroup({ actorId: A, name: "spare" }),
    field: await b.createCustomFieldDefinition({ actorId: A, name: "spare", fieldType: "string", constraints: {}, scope: {} }),
    project: await b.createProject({ actorId: A, identifier: "spare", name: "spare" }),
    key: await b.issueUserKey({ actorId: A, userId: I }),
    relation: (await b.listIssueRelations({ actorId: A, issueId: w.shown.id, pagination: { limit: 9 } })).items[0]!,
  };
  await b.addProjectMember({ actorId: A, projectId: spare.project.id, userId: I, roleIds: [id("roleId")] });
  await b.addGroupMember({ actorId: A, groupId: spare.group.id, userId: I });
  const notificationId = (await b.listNotifications({ actorId: A, recipientId: I, pagination: { limit: 9 } })).items[0]!.id;
  const issue = { actorId: A, issueId };
  return {
    createIssue: { actorId: A, projectId: pub, issueTypeId: s.issueTypeId, priorityId: s.priorityId, subject: "n", statusId: s.statusIds.todo, assigneeIds: [I], labelIds: [id("labelId")], categoryId: id("categoryId"), milestoneId: id("milestoneId"), parentIssueId: w.shown.id, dueDate: "2026-01-01", estimatedHours: 1 },
    updateIssue: { ...issue, subject: "changed" }, deleteIssue: issue, moveIssue: { ...issue, targetProjectId: spare.project.id },
    transitionIssueStatus: { ...issue, toStatusId: s.statusIds.done }, watchIssue: { actorId: w.limited.id, issueId: w.ofLimited.id }, unwatchIssue: { actorId: I, issueId },
    createIssueRelation: { ...issue, relatedIssueId: w.ofLimited.id, relationType: "blocks" }, deleteIssueRelation: { actorId: A, relationId: spare.relation.id },
    setIssueAssignees: { ...issue, assigneeIds: [w.limited.id] }, setIssueLabels: { ...issue, labelIds: [id("labelId")] }, setIssueCategory: { ...issue, categoryId: id("categoryId") },
    setIssueMilestone: { ...issue, milestoneId: id("milestoneId") }, setIssueParent: { actorId: A, childIssueId: w.ofLimited.id, parentIssueId: issueId }, setIssueIteration: { ...issue, iterationId: id("iterationId") },
    setIssueSchedule: { ...issue, dueDate: "2026-07-07" }, setIssueEstimation: { ...issue, estimatedHours: 77 }, setIssueProgress: { ...issue, doneRatio: 50 },
    createComment: { ...issue, body: "hi @limited @insider" }, updateComment: { actorId: I, commentId: id("commentId"), body: "now @limited" }, deleteComment: { actorId: I, commentId: id("commentId") },
    createAttachment: { ...{ actorId: A }, targetType: "issue", targetId: issueId, filename: "f", contentType: "a/b", sizeBytes: 1, storageKey: "k" }, deleteAttachment: { actorId: A, attachmentId: id("attachmentId") },
    createProject: { actorId: A, identifier: "new", name: "N", parentProjectId: pub }, updateProject: { actorId: A, projectId: pub, name: "N" }, deleteProject: { actorId: A, projectId: spare.project.id },
    archiveProject: { actorId: A, projectId: pub }, unarchiveProject: { actorId: A, projectId: pub }, setProjectVisibility: { actorId: A, projectId: pub, visibility: "private" }, setProjectParent: { actorId: A, childProjectId: spare.project.id, parentProjectId: pub },
    addProjectMember: { actorId: A, projectId: pub, userId: spare.user.id, roleIds: [id("roleId"), id("roleId", 1)] }, updateProjectMember: { actorId: A, projectId: pub, userId: I, roleIds: [id("roleId", 1)] }, removeProjectMember: { actorId: A, projectId: pub, userId: I },
    createMilestone: { actorId: A, projectId: pub, name: "n" }, updateMilestone: { actorId: A, milestoneId: id("milestoneId"), name: "n" }, deleteMilestone: { actorId: A, milestoneId: id("milestoneId") },
    closeMilestone: { actorId: A, milestoneId: id("milestoneId") }, reopenMilestone: { actorId: A, milestoneId: id("milestoneId") }, lockMilestone: { actorId: A, milestoneId: id("milestoneId") },
    createIteration: { actorId: A, projectId: pub, name: "n", startDate: "2026-01-01", endDate: "2026-01-02" }, updateIteration: { actorId: A, iterationId: id("iterationId"), name: "n" }, deleteIteration: { actorId: A, iterationId: id("iterationId") },
    createTimeEntry: { actorId: A, projectId: pub, issueId, userId: I, activityId: "dev", hours: 1, spentOn: "2026-01-01" }, updateTimeEntry: { actorId: A, timeEntryId: id("timeEntryId"), hours: 2 }, deleteTimeEntry: { actorId: A, timeEntryId: id("timeEntryId") },
    createDraftIssue: { actorId: A, projectId: pub, title: "n" }, updateDraftIssue: { actorId: A, draftId: id("draftId"), title: "n" }, deleteDraftIssue: { actorId: A, draftId: id("draftId") },
    convertDraftToIssue: { actorId: A, draftId: id("draftId"), issueTypeId: s.issueTypeId, priorityId: s.priorityId, statusId: s.statusIds.todo },
    createIssueTemplate: { actorId: A, projectId: pub, name: "n", descriptionTemplate: "" }, updateIssueTemplate: { actorId: A, templateId: id("templateId"), name: "n" }, deleteIssueTemplate: { actorId: A, templateId: id("templateId") },
    createProjectView: { actorId: A, projectId: pub, ownerId: A, name: "n", filter: {} }, updateProjectView: { actorId: A, viewId: id("viewId"), name: "n" }, deleteProjectView: { actorId: A, viewId: id("viewId") }, moveIssueOnBoard: { actorId: A, viewId: id("viewId"), issueId, position: 5 },
    markNotificationRead: { actorId: I, notificationId }, markAllNotificationsRead: { actorId: I },
    setWorkflowTransitions: { actorId: A, projectId: pub, issueTypeId: s.issueTypeId, transitions: [1, 2].map(() => ({ fromStatusId: s.statusIds.todo, toStatusId: s.statusIds.inProgress, roleIds: [] })) }, setDefaultStatus: { actorId: A, projectId: pub, issueTypeId: s.issueTypeId, statusId: s.statusIds.done },
    setUserStatus: { actorId: A, userId: I, status: "inactive" }, addGroupMember: { actorId: A, groupId: spare.group.id, userId: w.limited.id }, removeGroupMember: { actorId: A, groupId: spare.group.id, userId: I },
    issueUserKey: { actorId: A, userId: I }, revokeUserKey: { actorId: A, userId: I, keyId: spare.key.keyId },
    createStatus: { actorId: A, name: "n", category: "todo", sortOrder: 1 }, updateStatus: { actorId: A, statusId: spare.status.id, name: "n" }, deleteStatus: { actorId: A, statusId: spare.status.id },
    createPriority: { actorId: A, name: "n" }, updatePriority: { actorId: A, priorityId: spare.priority.id, name: "n" }, deletePriority: { actorId: A, priorityId: spare.priority.id },
    createLabel: { actorId: A, projectId: pub, name: "n", color: "#000000" }, updateLabel: { actorId: A, labelId: id("labelId"), name: "n" }, deleteLabel: { actorId: A, labelId: id("labelId") },
    createIssueType: { actorId: A, name: "n" }, updateIssueType: { actorId: A, issueTypeId: spare.type.id, name: "n" }, deleteIssueType: { actorId: A, issueTypeId: spare.type.id },
    createCategory: { actorId: A, projectId: pub, name: "n" }, updateCategory: { actorId: A, categoryId: id("categoryId"), name: "n" }, deleteCategory: { actorId: A, categoryId: id("categoryId") },
    createRole: { actorId: A, name: "n", permissions: [], issuesVisibility: "all" }, updateRole: { actorId: A, roleId: spare.role.id, name: "n" }, deleteRole: { actorId: A, roleId: spare.role.id },
    createUser: { actorId: A, login: "n", email: "n@x.io", displayName: "n" }, updateUser: { actorId: A, userId: spare.user.id, displayName: "n" }, deleteUser: { actorId: A, userId: spare.user.id },
    createUserGroup: { actorId: A, name: "n" }, updateUserGroup: { actorId: A, groupId: spare.group.id, name: "n" }, deleteUserGroup: { actorId: A, groupId: spare.group.id },
    createCustomFieldDefinition: { actorId: A, name: "n", fieldType: "string", constraints: {}, scope: {} }, updateCustomFieldDefinition: { actorId: A, fieldId: spare.field.id, name: "n" }, deleteCustomFieldDefinition: { actorId: A, fieldId: spare.field.id },
  };
}

/** A database whose nth write can be made to fail, and copied as it stands. */
function faulty(source?: Buffer) {
  const raw = source ? new SQLite(source) : new SQLite(":memory:");
  raw.pragma("foreign_keys = on");
  const fault = { writes: 0, failAt: 0 };
  const database = new Proxy(raw, {
    get(t, k) {
      const v = Reflect.get(t, k, t) as unknown;
      if (k !== "prepare") return typeof v === "function" ? v.bind(t) : v;
      return (text: string) => {
        const stmt = t.prepare(text);
        if (!/^\s*(insert|update|delete)/i.test(text)) return stmt;
        return new Proxy(stmt, {
          get(st, m) {
            const f = Reflect.get(st, m, st) as unknown;
            if (m === "run" || m === "all" || m === "iterate") return (...a: unknown[]) => {
              if (++fault.writes === fault.failAt) throw new Error("injected");
              return (f as (...x: unknown[]) => unknown).apply(st, a);
            };
            return typeof f === "function" ? f.bind(st) : f;
          },
        });
      };
    },
  });
  return { raw, fault, db: new Kysely<Database>({ dialect: new SqliteDialect({ database: database as never }) }) };
}

const dump = (raw: SQLite.Database): string => JSON.stringify(
  (raw.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite%' order by 1").all() as { name: string }[]).map(({ name }) => [name, raw.prepare(`select * from "${name}" order by 1`).all()]),
);

async function prepared() {
  const base = faulty();
  await migrateToLatest(base.db);
  const w = await world(base.db);
  const args = await validArgs(w, w.privateIssue.id);
  return { w, args, image: base.raw.serialize() };
}

describe("every write", () => {
  it("is all or nothing: wherever it fails, the database is as it was", async () => {
    const { args, image } = await prepared();
    expect(WRITES.filter((n) => !args[n])).toEqual([]);
    const torn: string[] = [];
    for (const name of WRITES) {
      const ok = faulty(image);
      ok.fault.writes = 0;
      await (createSqlBehaviors(ok.db)[name] as (a: unknown) => Promise<unknown>)(args[name]).catch((e: Error) => { throw new Error(`${name} should succeed: ${e.message}`); });
      const total = ok.fault.writes;
      for (let n = 1; n <= total; n++) {
        const f = faulty(image);
        const before = dump(f.raw);
        f.fault.writes = 0;
        f.fault.failAt = n;
        const failed = await (createSqlBehaviors(f.db)[name] as (a: unknown) => Promise<unknown>)(args[name]).then(() => false, () => true);
        if (!failed || dump(f.raw) !== before) torn.push(`${name}: write ${n} of ${total}${failed ? "" : " (failure swallowed)"}`);
      }
    }
    expect(torn.join("\n")).toBe("");
  }, 60_000);

  it("to an issue or what hangs off it takes being able to read it", async () => {
    const { w, args, image } = await prepared();
    const hidden: Record<string, string[]> = {
      issueId: [w.privateIssue.id, w.shown.id], childIssueId: [w.privateIssue.id], parentIssueId: [w.privateIssue.id], relatedIssueId: [w.privateIssue.id], targetId: [w.privateIssue.id],
      relationId: [(args.deleteIssueRelation as { relationId: string }).relationId],
      // what is in a project they can't see, and someone else's private view
      projectId: [w.priv], targetProjectId: [w.priv], viewId: [...w.ids.viewId!.filter((v) => w.hiddenConfig.includes(v)), w.personal.id],
      ...Object.fromEntries(["milestoneId", "iterationId", "templateId", "draftId"].map((k) => [k, w.ids[k]!.filter((i) => w.hiddenConfig.includes(i))])),
      ...Object.fromEntries(["commentId", "attachmentId", "timeEntryId"].map((k) => [k, w.ids[k]!.filter((i) => w.privateIssue.made.includes(i) || w.shown.made.includes(i))])),
    };
    const through: string[] = [];
    let tried = 0;
    for (const name of WRITES) {
      for (const [k, list] of Object.entries(hidden)) {
        if (!(k in args[name]!)) continue;
        // Only the one id is hidden: the issue itself is one they can read.
        const contract: Record<string, unknown> = { ...args[name]!, ...(k !== "issueId" && "issueId" in args[name]! ? { issueId: w.ofLimited.id } : {}) };
        for (const id of list) {
          const f = faulty(image);
          const before = dump(f.raw);
          tried++;
          const err = await (createSqlBehaviors(f.db)[name] as (a: unknown) => Promise<unknown>)({ ...contract, actorId: w.limited.id, [k]: id }).then(() => undefined, (e: Error) => e);
          const given = JSON.stringify({ ...contract, [k]: id });
          const told = [...w.secretFrom.limited].filter((x) => x && err?.message.includes(x) && !given.includes(x));
          if (told.length > 0) through.push(`${name} ${k}: its error names something hidden`);
          if (name === "unwatchIssue") { if (dump(f.raw) !== before) through.push(`${name} changed something`); continue; }
          if (!err || dump(f.raw) !== before) through.push(`${name} ${k}: went through`);
          else {
            // What is hidden must look exactly like what is not there.
            const none = "00000000-0000-4000-8000-000000000000";
            const g = faulty(image);
            const other = await (createSqlBehaviors(g.db)[name] as (a: unknown) => Promise<unknown>)({ ...contract, actorId: w.limited.id, [k]: none }).then(() => undefined, (e: Error) => e);
            const say = (e: Error | undefined, at: string) => `${e?.name}: ${e?.message.replaceAll(at, "?")}`;
            if (say(err, id) !== say(other, none)) through.push(`${name} ${k}: "${say(err, id)}" but "${say(other, none)}" for what is not there`);
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(30);
    expect([...new Set(through)].join("\n")).toBe("");
  }, 60_000);
});

