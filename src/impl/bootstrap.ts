import type { Behaviors } from "../mcp/behaviors.js";
import type { IssuedCredential } from "../schema/index.js";

export interface BootstrapResult {
  adminId: string;
  memberId: string;
  projectId: string;
  issueTypeId: string;
  priorityId: string;
  statusIds: { todo: string; inProgress: string; done: string };
  /** True when this call actually seeded (the DB was empty). */
  seeded: boolean;
}

/** Permissions granted to the default Member role — enough for day-to-day work, but not administration. */
const MEMBER_PERMISSIONS = [
  "issue.create", "issue.update", "issue.delete", "issue.move", "issue.assign",
  "comment.create", "comment.update", "comment.delete",
  "attachment.create", "attachment.delete",
  "time_entry.create", "time_entry.update", "time_entry.delete",
  "milestone.manage", "iteration.manage",
] as const;

/**
 * Seed a minimal working world the first time the server runs against an empty
 * database: an internal admin, a Member role, a default project with a member
 * user, a todo/in_progress/done status set, a default issue type/priority, a
 * workflow, and a default status. Idempotent — does nothing if users exist.
 *
 * The seed runs as the internal admin; the SERVED identity is the (non-admin)
 * member, so the permission/visibility checks are live for normal operation.
 *
 * No signing keys are minted here: a key whose private half nobody holds is an
 * active credential with no owner. Use issueSeedKeys when the caller has a
 * place to hand the private keys to.
 */
export async function ensureBootstrapped(b: Behaviors): Promise<BootstrapResult | null> {
  const existing = await b.listUsers({ actorId: "system", pagination: { limit: 1 } });
  if (existing.items.length > 0) return null;

  const admin = await b.createUser({ actorId: "system", login: "admin", email: "admin@stamm.local", displayName: "Admin", kind: "admin" });
  const memberRole = await b.createRole({ actorId: admin.id, name: "Member", permissions: [...MEMBER_PERMISSIONS], issuesVisibility: "all" });

  const todo = await b.createStatus({ actorId: admin.id, name: "To Do", category: "todo", sortOrder: 0 });
  const inProgress = await b.createStatus({ actorId: admin.id, name: "In Progress", category: "in_progress", sortOrder: 1 });
  const done = await b.createStatus({ actorId: admin.id, name: "Done", category: "done", sortOrder: 2 });
  const priority = await b.createPriority({ actorId: admin.id, name: "Normal", sortOrder: 0 });
  const issueType = await b.createIssueType({ actorId: admin.id, name: "Task" });

  const project = await b.createProject({ actorId: admin.id, identifier: "default", name: "Default Project" });
  const member = await b.createUser({ actorId: admin.id, login: "member", email: "member@stamm.local", displayName: "Member" });
  await b.addProjectMember({ actorId: admin.id, projectId: project.id, userId: member.id, roleIds: [memberRole.id] });

  await b.setWorkflowTransitions({
    actorId: admin.id,
    projectId: project.id,
    issueTypeId: issueType.id,
    transitions: [
      { fromStatusId: todo.id, toStatusId: inProgress.id, roleIds: [memberRole.id] },
      { fromStatusId: inProgress.id, toStatusId: done.id, roleIds: [memberRole.id] },
      { fromStatusId: inProgress.id, toStatusId: todo.id, roleIds: [memberRole.id] },
      { fromStatusId: done.id, toStatusId: inProgress.id, roleIds: [memberRole.id] },
      { fromStatusId: todo.id, toStatusId: done.id, roleIds: [memberRole.id] },
    ],
  });
  await b.setDefaultStatus({ actorId: admin.id, projectId: project.id, issueTypeId: issueType.id, statusId: todo.id });

  return {
    adminId: admin.id,
    memberId: member.id,
    projectId: project.id,
    issueTypeId: issueType.id,
    priorityId: priority.id,
    statusIds: { todo: todo.id, inProgress: inProgress.id, done: done.id },
    seeded: true,
  };
}

export interface SeedKeys {
  adminKey: IssuedCredential;
  memberKey: IssuedCredential;
}

/**
 * Mint a signing key for the seeded admin and member. The private keys are
 * returned once. actorId is the real admin (a "system" actor would fail
 * assertGlobalAdmin).
 */
export async function issueSeedKeys(b: Behaviors, seed: Pick<BootstrapResult, "adminId" | "memberId">): Promise<SeedKeys> {
  const adminKey = await b.issueUserKey({ actorId: seed.adminId, userId: seed.adminId });
  const memberKey = await b.issueUserKey({ actorId: seed.adminId, userId: seed.memberId });
  return { adminKey, memberKey };
}

/** Revoke keys minted by issueSeedKeys (e.g. when they could not be handed over). */
export async function revokeSeedKeys(b: Behaviors, seed: Pick<BootstrapResult, "adminId" | "memberId">, keys: SeedKeys): Promise<void> {
  await b.revokeUserKey({ actorId: seed.adminId, userId: seed.adminId, keyId: keys.adminKey.keyId });
  await b.revokeUserKey({ actorId: seed.adminId, userId: seed.memberId, keyId: keys.memberKey.keyId });
}
