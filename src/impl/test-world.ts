import { createTestDb } from "./test-db.js";
import { createSqlBehaviors } from "./index.js";
import { ensureBootstrapped } from "./bootstrap.js";
import type { Kysely } from "kysely";
import type { Database } from "./db/schema.js";

const page = { pagination: { limit: 100 } };
export type Ids = Record<string, string[]>;

/**
 * One workspace seen by people who may see different parts of it. Everything is
 * made twice: what a viewer may see, and what they may not. `secret` collects the ids
 * and words of the latter.
 */
export async function world(db?: Kysely<Database>) {
  db ??= await createTestDb();
  const b = createSqlBehaviors(db);
  const s = (await ensureBootstrapped(b))!;
  const A = s.adminId;
  const all = (await b.listRoles({ actorId: A, ...page })).items[0]!;
  const own = await b.createRole({ actorId: A, name: "Own", permissions: [...all.permissions, "view.manage", "template.manage"], issuesVisibility: "own_or_assigned" });
  const mkUser = (login: string) => b.createUser({ actorId: A, login, email: `${login}@secret.example`, displayName: login });
  const insider = await mkUser("insider"), limited = await mkUser("limited"), outsider = await mkUser("outsider");
  const pub = s.projectId;
  const priv = (await b.createProject({ actorId: A, identifier: "hidden-project", name: "HIDDENWORD project", visibility: "private" })).id;
  for (const p of [pub, priv]) await b.addProjectMember({ actorId: A, projectId: p, userId: insider.id, roleIds: [all.id] });
  await b.addProjectMember({ actorId: A, projectId: pub, userId: limited.id, roleIds: [own.id] });
  await db.updateTable("roles").set({ permissions: JSON.stringify([...all.permissions, "view.manage", "template.manage"]) }).where("id", "=", all.id).execute();

  const ids: Ids = { userId: [A, insider.id, limited.id, outsider.id], projectId: [pub, priv], roleId: [all.id, own.id], issueTypeId: [s.issueTypeId], statusId: Object.values(s.statusIds), priorityId: [s.priorityId] };
  const add = (k: string, id: string) => { (ids[k] ??= []).push(id); return id; };
  const word = (hidden: boolean) => (hidden ? "HIDDENWORD" : "shown");

  /** An issue with everything that can hang off one. */
  const issue = async (projectId: string, hidden: boolean, visibility: "public" | "private") => {
    const actorId = insider.id, made: string[] = [];
    const keep = (k: string, id: string) => { made.push(id); return add(k, id); };
    const base = { actorId, projectId, issueTypeId: s.issueTypeId, priorityId: s.priorityId, statusId: s.statusIds.todo, visibility };
    const id = keep("issueId", (await b.createIssue({ ...base, subject: `${word(hidden)} subject`, description: word(hidden), dueDate: "2026-04-01", estimatedHours: 3, assigneeIds: [insider.id] })).id);
    await b.transitionIssueStatus({ actorId: A, issueId: id, toStatusId: s.statusIds.inProgress });
    keep("commentId", (await b.createComment({ actorId, issueId: id, body: word(hidden) })).id);
    keep("attachmentId", (await b.createAttachment({ actorId, targetType: "issue", targetId: id, filename: `${word(hidden)}.txt`, contentType: "text/plain", sizeBytes: 1, storageKey: "k" })).id);
    keep("timeEntryId", (await b.createTimeEntry({ actorId, projectId, issueId: id, userId: insider.id, activityId: "dev", hours: 1, spentOn: "2026-03-01", comment: word(hidden) })).id);
    await b.watchIssue({ actorId, issueId: id });
    for (const a of (await b.listActivities({ actorId: A, targetId: id, ...page })).items) keep("activityId", a.id);
    for (const c of (await b.listIssueChanges({ actorId: A, projectId, ...page })).items.filter((x) => x.issueId === id)) made.push(c.id);
    return { id, made };
  };
  const shown = await issue(pub, false, "public");
  const privateIssue = await issue(pub, true, "private");
  const inPriv = await issue(priv, true, "public");
  const ofLimited = await b.createIssue({ actorId: limited.id, projectId: pub, issueTypeId: s.issueTypeId, priorityId: s.priorityId, subject: "mine" });
  add("issueId", ofLimited.id);
  const deleted = await issue(pub, true, "private");
  await b.deleteIssue({ actorId: A, issueId: deleted.id });
  for (const [x, y] of [[shown.id, privateIssue.id], [shown.id, inPriv.id], [ofLimited.id, privateIssue.id]] as const) {
    await b.createIssueRelation({ actorId: A, issueId: x, relatedIssueId: y, relationType: "relates_to" });
  }
  await b.setIssueParent({ actorId: A, childIssueId: shown.id, parentIssueId: privateIssue.id });
  await b.setIssueParent({ actorId: A, childIssueId: inPriv.id, parentIssueId: shown.id });
  const privateComment = await b.createComment({ actorId: insider.id, issueId: shown.id, body: "HIDDENWORD note", visibility: "private" });
  add("commentId", privateComment.id);

  /** What a project is configured with. */
  const config = async (projectId: string, hidden: boolean) => {
    const made: string[] = [], w = word(hidden), actorId = A;
    const keep = (k: string, id: string) => { made.push(id); return add(k, id); };
    keep("labelId", (await b.createLabel({ actorId, projectId, name: w, color: "#000000" })).id);
    keep("categoryId", (await b.createCategory({ actorId, projectId, name: w })).id);
    keep("milestoneId", (await b.createMilestone({ actorId, projectId, name: w })).id);
    keep("iterationId", (await b.createIteration({ actorId, projectId, name: w, startDate: "2026-01-01", endDate: "2026-01-14" })).id);
    keep("templateId", (await b.createIssueTemplate({ actorId, projectId, name: w, descriptionTemplate: w })).id);
    keep("draftId", (await b.createDraftIssue({ actorId, projectId, title: w })).id);
    keep("fieldId", (await b.createCustomFieldDefinition({ actorId, name: w, fieldType: "string", constraints: {}, scope: { projectIds: [projectId] } })).id);
    keep("viewId", (await b.createProjectView({ actorId, projectId, ownerId: insider.id, name: w, filter: {}, visibility: "public" })).id);
    keep("timeEntryId", (await b.createTimeEntry({ actorId, projectId, userId: insider.id, activityId: "dev", hours: 1, spentOn: "2026-03-01", comment: w })).id);
    await b.setDefaultStatus({ actorId, projectId, issueTypeId: s.issueTypeId, statusId: s.statusIds.todo });
    await b.setWorkflowTransitions({ actorId, projectId, issueTypeId: s.issueTypeId, transitions: [{ fromStatusId: s.statusIds.todo, toStatusId: s.statusIds.done, roleIds: [] }] });
    return made;
  };
  await config(pub, false);
  const hiddenConfig = await config(priv, true);
  const personal = await b.createProjectView({ actorId: insider.id, projectId: pub, ownerId: insider.id, name: "HIDDENWORD view", filter: {}, visibility: "private" });
  add("viewId", personal.id);
  for (const i of [shown.id, privateIssue.id]) await b.moveIssueOnBoard({ actorId: A, viewId: ids.viewId![0]!, issueId: i, position: 1 });
  const key = await b.issueUserKey({ actorId: A, userId: insider.id });
  for (const n of (await b.listNotifications({ actorId: A, recipientId: insider.id, ...page })).items) add("notificationId", n.id);
  const group = add("groupId", (await b.createUserGroup({ actorId: A, name: "g" })).id);
  await b.addGroupMember({ actorId: A, groupId: group, userId: insider.id });

  const HIDDEN_FROM_ALL = [...inPriv.made, ...hiddenConfig, "HIDDENWORD project", "hidden-project", personal.id, key.keyId, ...(ids.notificationId ?? []), "insider@secret.example", "admin@stamm.local"];
  return {
    db, b, s, A, insider, limited, outsider, pub, priv, ids, shown, privateIssue, inPriv, deleted, ofLimited, privateComment, hiddenConfig, personal,
    secretFrom: {
      outsider: [...HIDDEN_FROM_ALL, ...privateIssue.made, ...deleted.made, privateComment.id, "HIDDENWORD"],
      limited: [...HIDDEN_FROM_ALL, ...privateIssue.made, ...deleted.made, ...shown.made, "HIDDENWORD", "shown subject"],
      scoped: [...inPriv.made, ...hiddenConfig, "HIDDENWORD project", "hidden-project", personal.id === "" ? "" : key.keyId, "other@secret.example"],
    },
  };
}
export type W = Awaited<ReturnType<typeof world>>;

