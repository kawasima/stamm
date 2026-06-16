// Simulation: drive a realistic PM workflow through the stamm data + behavior layers.
// The behavior layer is a set of zod z.function() *contracts*. We implement each
// contract with an in-memory backend via `.implement()`, so every call validates
// its args AND its return value against the schema. If our backend ever returns
// something the schema forbids, zod throws — that's the point.
//
// This revision exercises the three fixes:
//   1. actorId on every mutation (and viewer actorId on visibility-sensitive reads)
//   2. createdAt/updatedAt derived from the ActivityEntry timeline (no Issue field)
//   3. compound reads: GetIssueDetail + ListIssues `include` -> IssueListItem

import { randomUUID } from "node:crypto";
import * as B from "../dist/behavior/index.js";

const uid = () => randomUUID();
const today = "2026-06-16";
const addDays = (d, n) => {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
// monotonic clock so ActivityEntry.occurredAt is strictly increasing (lets us
// derive createdAt/updatedAt and sort by them deterministically)
let clock = Date.parse(today + "T00:00:00Z");
const now = () => new Date((clock += 1000)).toISOString();

// ----- in-memory store -----
const db = {
  roles: new Map(), users: new Map(), projects: new Map(),
  memberships: [], issueTypes: new Map(), priorities: new Map(),
  statuses: new Map(), defaultStatus: new Map(), transitions: [],
  issues: new Map(), issueSeq: new Map(), statusChanges: [],
  assignees: [], labels: [], estimations: new Map(), progress: new Map(),
  iterations: new Map(), issueIterations: new Map(), comments: [],
  activities: [], // the canonical timeline — source of createdAt/updatedAt
};

// Append to the canonical timeline. Every mutation calls this with its actor.
const record = (actorId, action, targetType, targetId, projectId) => {
  db.activities.push({
    id: uid(), projectId, userId: actorId, action,
    changes: [], occurredAt: now(), targetType, targetId,
  });
};
// Derived timestamps (decision 2): no field on Issue; read from the timeline.
const createdAt = (targetId) =>
  db.activities.find((a) => a.targetId === targetId && a.action === "created")?.occurredAt;
const updatedAt = (targetId) =>
  db.activities.filter((a) => a.targetId === targetId)
    .reduce((m, a) => (a.occurredAt > m ? a.occurredAt : m), "");

// ============================================================
// Implement the contracts (.implement validates args + returns)
// ============================================================
const CreateRole = B.CreateRole.implement(async (a) => {
  const r = { id: uid(), issuesVisibility: "all", ...a }; delete r.actorId;
  db.roles.set(r.id, r); return r;
});
const CreateUser = B.CreateUser.implement(async (a) => {
  const u = { id: uid(), language: "en", kind: "regular", ...a }; delete u.actorId;
  db.users.set(u.id, u); return u;
});
const CreateProject = B.CreateProject.implement(async (a) => {
  const p = { id: uid(), identifier: a.identifier, name: a.name, description: a.description };
  db.projects.set(p.id, p);
  record(a.actorId, "created", "project", p.id, p.id);
  return p;
});
const AddProjectMember = B.AddProjectMember.implement(async (a) => {
  const m = { id: uid(), projectId: a.projectId, userId: a.userId, roleIds: a.roleIds };
  db.memberships.push(m); return m;
});
const CreateStatus = B.CreateStatus.implement(async (a) => {
  const s = { id: uid(), name: a.name, category: a.category, color: a.color,
    description: a.description, sortOrder: a.sortOrder ?? 0 };
  db.statuses.set(s.id, s); return s;
});
const SetWorkflowTransitions = B.SetWorkflowTransitions.implement(async (a) => {
  db.transitions = db.transitions.filter(
    (t) => !(t.projectId === a.projectId && t.issueTypeId === a.issueTypeId));
  const created = a.transitions.map((t) => {
    const wt = { id: uid(), projectId: a.projectId, issueTypeId: a.issueTypeId, ...t };
    db.transitions.push(wt); return wt;
  });
  return { transitions: created };
});
const SetDefaultStatus = B.SetDefaultStatus.implement(async (a) => {
  const s = { id: uid(), projectId: a.projectId, issueTypeId: a.issueTypeId, statusId: a.statusId };
  db.defaultStatus.set(`${a.projectId}:${a.issueTypeId}`, s); return s;
});
const CreateIteration = B.CreateIteration.implement(async (a) => {
  const it = { id: uid(), projectId: a.projectId, name: a.name,
    startDate: a.startDate, endDate: a.endDate, sortOrder: a.sortOrder ?? 0 };
  db.iterations.set(it.id, it); return it;
});

const CreateIssue = B.CreateIssue.implement(async (a) => {
  const seq = (db.issueSeq.get(a.projectId) ?? 0) + 1;
  db.issueSeq.set(a.projectId, seq);
  const proj = db.projects.get(a.projectId);
  let statusId = a.statusId;
  if (!statusId) {
    const def = db.defaultStatus.get(`${a.projectId}:${a.issueTypeId}`);
    if (!def) throw new Error("no default status for project+type");
    statusId = def.statusId;
  }
  const issue = {
    id: uid(), key: proj.identifier.toUpperCase(), number: seq,
    projectId: a.projectId, issueTypeId: a.issueTypeId, priorityId: a.priorityId,
    statusId, subject: a.subject, description: a.description,
    authorId: a.actorId,                 // <-- actor now drives authorship
    visibility: a.visibility ?? "public", customFields: a.customFields ?? [],
  };
  db.issues.set(issue.id, issue);
  for (const aid of a.assigneeIds ?? []) db.assignees.push({ id: uid(), issueId: issue.id, assigneeId: aid });
  for (const lid of a.labelIds ?? []) db.labels.push({ id: uid(), issueId: issue.id, labelId: lid });
  if (a.estimatedHours != null) db.estimations.set(issue.id, { id: uid(), issueId: issue.id, estimatedHours: a.estimatedHours });
  db.statusChanges.push({ id: uid(), occurredAt: now(), issueId: issue.id,
    fromStatusId: undefined, toStatusId: statusId, userId: a.actorId });
  record(a.actorId, "created", "issue", issue.id, issue.projectId);
  return issue;
});

const AssignIssue = B.AssignIssue.implement(async (a) => {
  const rec = { id: uid(), issueId: a.issueId, assigneeId: a.assigneeId };
  db.assignees.push(rec);
  record(a.actorId, "assigned", "issue", a.issueId, db.issues.get(a.issueId).projectId);
  return rec;
});
const SetIssueEstimation = B.SetIssueEstimation.implement(async (a) => {
  const rec = { id: uid(), issueId: a.issueId, estimatedHours: a.estimatedHours };
  db.estimations.set(a.issueId, rec);
  record(a.actorId, "estimated", "issue", a.issueId, db.issues.get(a.issueId).projectId);
  return rec;
});
const SetIssueProgress = B.SetIssueProgress.implement(async (a) => {
  const rec = { id: uid(), issueId: a.issueId, doneRatio: a.doneRatio };
  db.progress.set(a.issueId, rec);
  record(a.actorId, "progress_updated", "issue", a.issueId, db.issues.get(a.issueId).projectId);
  return rec;
});
const SetIssueIteration = B.SetIssueIteration.implement(async (a) => {
  const rec = { id: uid(), issueId: a.issueId, iterationId: a.iterationId };
  db.issueIterations.set(a.issueId, rec);
  record(a.actorId, "iteration_set", "issue", a.issueId, db.issues.get(a.issueId).projectId);
  return rec;
});

const actorRolesIn = (projectId, userId) =>
  db.memberships.filter((m) => m.projectId === projectId && m.userId === userId).flatMap((m) => m.roleIds);

const TransitionIssueStatus = B.TransitionIssueStatus.implement(async (a) => {
  const issue = db.issues.get(a.issueId);
  const roleIds = new Set(actorRolesIn(issue.projectId, a.actorId));
  const t = db.transitions.find(
    (t) => t.projectId === issue.projectId && t.issueTypeId === issue.issueTypeId &&
      t.fromStatusId === issue.statusId && t.toStatusId === a.toStatusId);
  if (!t) throw new Error(`illegal transition ${issue.statusId} -> ${a.toStatusId}`);
  if (!t.roleIds.some((r) => roleIds.has(r))) throw new Error("actor lacks a role permitted for this transition");
  db.statusChanges.push({ id: uid(), occurredAt: now(), issueId: issue.id,
    fromStatusId: issue.statusId, toStatusId: a.toStatusId, userId: a.actorId });
  record(a.actorId, "status_changed", "issue", issue.id, issue.projectId);
  issue.statusId = a.toStatusId;
  return issue;
});

const CreateComment = B.CreateComment.implement(async (a) => {
  const c = { id: uid(), occurredAt: now(), issueId: a.issueId,
    authorId: a.actorId, body: a.body, visibility: a.visibility ?? "public" };
  db.comments.push(c);
  record(a.actorId, "commented", "issue", a.issueId, db.issues.get(a.issueId).projectId);
  return c;
});

// ----- reads (viewer = actorId) -----
const hydrate = (issueId, keys) => {
  const out = {};
  const has = (k) => keys.includes(k);
  if (has("assignees")) out.assignees = db.assignees.filter((x) => x.issueId === issueId);
  if (has("labels")) out.labels = db.labels.filter((x) => x.issueId === issueId);
  if (has("watchers")) out.watchers = [];
  if (has("relations")) out.relations = [];
  if (has("iteration")) out.iteration = db.issueIterations.get(issueId);
  if (has("estimation")) out.estimation = db.estimations.get(issueId);
  if (has("progress")) out.progress = db.progress.get(issueId);
  // category/milestone/parent/schedule: not tracked in this sim -> omitted (optional)
  return out;
};

const ALL_INCLUDE = ["assignees","labels","watchers","relations","iteration","estimation","progress"];
const GetIssueDetail = B.GetIssueDetail.implement(async (a) => {
  const issue = db.issues.get(a.issueId);
  // IssueDetail requires the four arrays present; hydrate everything.
  return { ...issue, ...hydrate(a.issueId, ALL_INCLUDE) };
});

const ListIssues = B.ListIssues.implement(async (a) => {
  const f = a.filter;
  let items = [...db.issues.values()];
  if (f.projectId) items = items.filter((i) => i.projectId === f.projectId);
  if (f.iterationId) items = items.filter((i) => db.issueIterations.get(i.id)?.iterationId === f.iterationId);
  // sort
  const dir = a.sortDirection === "desc" ? -1 : 1;
  if (a.sortBy === "updatedAt") items.sort((x, y) => (updatedAt(x.id) > updatedAt(y.id) ? 1 : -1) * dir);
  else if (a.sortBy === "createdAt") items.sort((x, y) => (createdAt(x.id) > createdAt(y.id) ? 1 : -1) * dir);
  else items.sort((x, y) => (x.number - y.number) * dir);
  // embed only requested satellites (IssueListItem; undefined = not requested)
  const inc = a.include ?? [];
  const rows = items.map((i) => (inc.length ? { ...i, ...hydrate(i.id, inc) } : { ...i }));
  return { items: rows, totalCount: rows.length };
});

// ============================================================
// Scenario
// ============================================================
const log = (...x) => console.log(...x);
const sep = (t) => log("\n=== " + t + " ===");

sep("1. Roles, users, project, members (mutations now carry actorId)");
// bootstrap actor for setup (a system/admin principal)
let SYS = "system";
const adminRole = await CreateRole({ actorId: SYS, name: "Admin", builtinKind: "admin",
  permissions: ["issue.create","issue.update","issue.assign","member.manage","role.manage","iteration.manage"] });
const devRole = await CreateRole({ actorId: SYS, name: "Developer", builtinKind: "member",
  permissions: ["issue.create","issue.update","issue.assign","comment.create"] });
const alice = await CreateUser({ actorId: SYS, login: "alice", email: "alice@example.com", displayName: "Alice (PO)" });
const bob = await CreateUser({ actorId: SYS, login: "bob", email: "bob@example.com", displayName: "Bob" });
const carol = await CreateUser({ actorId: SYS, login: "carol", email: "carol@example.com", displayName: "Carol" });
const proj = await CreateProject({ actorId: alice.id, identifier: "stamm", name: "Stamm Core" });
await AddProjectMember({ actorId: alice.id, projectId: proj.id, userId: alice.id, roleIds: [adminRole.id] });
await AddProjectMember({ actorId: alice.id, projectId: proj.id, userId: bob.id, roleIds: [devRole.id] });
await AddProjectMember({ actorId: alice.id, projectId: proj.id, userId: carol.id, roleIds: [devRole.id] });
log("project stamm with 3 members; every write recorded an actor");

sep("2. Issue types, priorities, statuses, workflow");
const story = { id: uid(), name: "Story", kind: "standard", sortOrder: 0 };
const bug = { id: uid(), name: "Bug", kind: "standard", sortOrder: 1 };
db.issueTypes.set(story.id, story); db.issueTypes.set(bug.id, bug);
const pHigh = { id: uid(), name: "High", sortOrder: 0 };
const pNorm = { id: uid(), name: "Normal", sortOrder: 1 };
db.priorities.set(pHigh.id, pHigh); db.priorities.set(pNorm.id, pNorm);
const todo = await CreateStatus({ actorId: alice.id, name: "To Do", category: "todo", sortOrder: 0 });
const doing = await CreateStatus({ actorId: alice.id, name: "In Progress", category: "in_progress", sortOrder: 1 });
const review = await CreateStatus({ actorId: alice.id, name: "In Review", category: "in_progress", sortOrder: 2 });
const done = await CreateStatus({ actorId: alice.id, name: "Done", category: "done", sortOrder: 3 });
for (const t of [story, bug]) {
  await SetWorkflowTransitions({ actorId: alice.id, projectId: proj.id, issueTypeId: t.id, transitions: [
    { fromStatusId: todo.id, toStatusId: doing.id, roleIds: [adminRole.id, devRole.id] },
    { fromStatusId: doing.id, toStatusId: review.id, roleIds: [adminRole.id, devRole.id] },
    { fromStatusId: review.id, toStatusId: done.id, roleIds: [adminRole.id] },
    { fromStatusId: review.id, toStatusId: doing.id, roleIds: [adminRole.id, devRole.id] },
  ]});
  await SetDefaultStatus({ actorId: alice.id, projectId: proj.id, issueTypeId: t.id, statusId: todo.id });
}
log("workflow: To Do -> In Progress -> In Review -> Done (Done is Admin-only)");

sep("3. Sprint + issues (compound create, actor = PO alice)");
const sprint = await CreateIteration({ actorId: alice.id, projectId: proj.id, name: "Sprint 1", startDate: today, endDate: addDays(today, 14) });
const i1 = await CreateIssue({ actorId: alice.id, projectId: proj.id, issueTypeId: story.id, priorityId: pHigh.id,
  subject: "ヘッドレスAPIのOpenAPI出力", assigneeIds: [bob.id], labelIds: ["lbl-api"], estimatedHours: 8 });
const i2 = await CreateIssue({ actorId: alice.id, projectId: proj.id, issueTypeId: story.id, priorityId: pNorm.id,
  subject: "Issueの一覧フィルタ", assigneeIds: [carol.id], labelIds: ["lbl-ui"], estimatedHours: 5 });
const i3 = await CreateIssue({ actorId: alice.id, projectId: proj.id, issueTypeId: bug.id, priorityId: pHigh.id,
  subject: "ステータス遷移の権限チェック漏れ", assigneeIds: [bob.id], estimatedHours: 3 });
for (const i of [i1, i2, i3]) await SetIssueIteration({ actorId: alice.id, issueId: i.id, iterationId: sprint.id });
log(`created ${i1.key}-${i1.number}, ${i2.key}-${i2.number}, ${i3.key}-${i3.number}; authorId == actorId == ${alice.login} (${i1.authorId === alice.id})`);

sep("4. Work the board (workflow + role enforced via actorId)");
await TransitionIssueStatus({ actorId: bob.id, issueId: i1.id, toStatusId: doing.id });
await SetIssueProgress({ actorId: bob.id, issueId: i1.id, doneRatio: 50 });
await TransitionIssueStatus({ actorId: bob.id, issueId: i1.id, toStatusId: review.id });
await CreateComment({ actorId: bob.id, issueId: i1.id, body: "レビューお願いします @alice" });
log("bob: i1 To Do -> In Progress -> In Review");
let denied = false;
try { await TransitionIssueStatus({ actorId: bob.id, issueId: i1.id, toStatusId: done.id }); }
catch (e) { denied = true; log("bob -> Done DENIED: " + e.message); }
if (!denied) throw new Error("expected role-gated transition to be denied");
await TransitionIssueStatus({ actorId: alice.id, issueId: i1.id, toStatusId: done.id });
await SetIssueProgress({ actorId: alice.id, issueId: i1.id, doneRatio: 100 });
log("alice (Admin): i1 In Review -> Done");

sep("5. Compound read: GetIssueDetail (one round-trip, no N+1)");
const detail = await GetIssueDetail({ actorId: alice.id, issueId: i1.id });
log(`${detail.key}-${detail.number} "${detail.subject}"`);
log(`  assignees=${detail.assignees.length} labels=${detail.labels.length} progress=${detail.progress?.doneRatio}% estimation=${detail.estimation?.estimatedHours}h iteration=${detail.iteration ? "Sprint 1" : "-"}`);

sep("6. List with include -> IssueListItem (board rows hydrated)");
const board = await ListIssues({ actorId: alice.id, filter: { projectId: proj.id, iterationId: sprint.id },
  include: ["assignees", "labels"], sortBy: "number", pagination: { limit: 50 } });
for (const r of board.items) {
  const who = r.assignees.map((x) => db.users.get(x.assigneeId)?.login ?? x.assigneeId).join(",");
  log(`  ${r.key}-${r.number} [${db.statuses.get(r.statusId).name}] assignees=${who} labels=${r.labels.length}`);
}

sep("7. List WITHOUT include -> bare Issue shape (backward compatible)");
const plain = await ListIssues({ actorId: alice.id, filter: { projectId: proj.id }, sortBy: "number", pagination: { limit: 50 } });
log(`  rows=${plain.items.length}, first row has assignees field? ${plain.items[0].assignees !== undefined} (undefined = not requested)`);

sep("8. Derived timestamps from the ActivityEntry timeline (no field on Issue)");
log(`Issue object has its own createdAt field? ${("createdAt" in i1)}`);
const bySort = await ListIssues({ actorId: alice.id, filter: { projectId: proj.id }, sortBy: "updatedAt", sortDirection: "desc", pagination: { limit: 50 } });
log("issues by updatedAt desc (derived from ActivityEntry):");
for (const r of bySort.items) log(`   ${r.key}-${r.number}  created=${createdAt(r.id)}  updated=${updatedAt(r.id)}`);

sep("DONE — actorId / GetIssueDetail / include / derived timestamps all validated against the zod contracts");
