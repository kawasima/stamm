import type { Kysely } from "kysely";
import type { NotificationEventType } from "../schema/index.js";
import type { Database } from "./db/schema.js";
import type { Ctx } from "./ctx.js";
import { extractMentions } from "./mentions.js";
import { canSeePrivateInProject, isMember } from "./permissions.js";
import { assertCanReadIssue, readersAmong } from "./issue-visibility.js";

export interface NotifyIssueInput {
  projectId: string;
  issueId: string;
  authorId: string;
  eventType: NotificationEventType;
  title: string;
  actorId: string;
  occurredAt?: string;
  /** Restrict recipients to this set (e.g. newly-added assignees) instead of the full audience. */
  onlyRecipients?: string[];
  /** Users who already got a more specific notification for this event (e.g. a mention). */
  exclude?: Iterable<string>;
  /** Only to members of the project, as for a private comment. */
  membersOnly?: boolean;
}

/**
 * Emit notifications as a side-effect of an issue write. Audience = author ∪
 * current assignees ∪ watchers (or `onlyRecipients` when given), minus the actor
 * (never notify yourself). Runs inside the triggering write's transaction.
 */
export async function notifyIssueEvent(ctx: Ctx, exec: Kysely<Database>, input: NotifyIssueInput): Promise<void> {
  if (ctx.silent) return;
  let recipients: Set<string>;
  if (input.onlyRecipients) {
    recipients = new Set(input.onlyRecipients);
  } else {
    const assignees = (await exec.selectFrom("issue_assignees").select("assignee_id").where("issue_id", "=", input.issueId).execute()).map((r) => r.assignee_id);
    const watchers = (await exec.selectFrom("issue_watchers").select("user_id").where("issue_id", "=", input.issueId).execute()).map((r) => r.user_id);
    recipients = new Set([input.authorId, ...assignees, ...watchers]);
  }
  recipients.delete(input.actorId);
  for (const id of input.exclude ?? []) recipients.delete(id);
  // Watching or having been assigned outlasts the right to read (a role changes, a
  // project is made private), so it is asked now.
  const theirs: Ctx = { db: exec, now: ctx.now, genId: ctx.genId }; // not limited by the writing key
  const readers = await readersAmong(theirs, input.issueId, [...recipients]);
  const to: string[] = [];
  for (const id of readers) if (!input.membersOnly || (await canSeePrivateInProject(theirs, input.projectId, id))) to.push(id);
  if (to.length === 0) return;
  const occurredAt = input.occurredAt ?? ctx.now();
  // One multi-row insert instead of a round-trip per recipient: a heavily
  // watched issue would otherwise make every write O(watchers) statements
  // inside the triggering transaction.
  const rows = to.map((recipientId) => ({
    id: ctx.genId(),
    recipient_id: recipientId,
    event_type: input.eventType,
    project_id: input.projectId,
    title: input.title,
    occurred_at: occurredAt,
    target_type: "issue",
    target_id: input.issueId,
  }));
  await exec.insertInto("notifications").values(rows).execute();
}

/**
 * Who a comment body mentions, as user ids. Only a project member who can read
 * the issue is a recipient: a mention of anyone else is plain text, so a comment
 * cannot be used to ping outsiders or to reveal an issue to someone who may not
 * see it. The author is never a recipient. Resolved before the write's
 * transaction opens, because it reads through the normal connection.
 */
export async function resolveMentionRecipients(
  ctx: Ctx,
  input: { projectId: string; issueId: string; actorId: string; body: string },
): Promise<string[]> {
  const logins = extractMentions(input.body);
  if (logins.length === 0) return [];
  const users = await ctx.db
    .selectFrom("users")
    .select(["id", "login"])
    .where((eb) => eb(eb.fn("lower", ["login"]), "in", logins))
    .execute();
  const recipients: string[] = [];
  for (const u of users) {
    if (u.id === input.actorId) continue;
    if (!(await isMember(ctx, input.projectId, u.id))) continue;
    try {
      await assertCanReadIssue(ctx, input.issueId, u.id);
    } catch {
      continue;
    }
    recipients.push(u.id);
  }
  return recipients;
}

/** Insert one `issue.mentioned` notification per recipient, pointing at the comment. */
export async function notifyMentions(
  ctx: Ctx,
  exec: Kysely<Database>,
  input: { projectId: string; issueKey: string; commentId: string; recipients: string[]; occurredAt: string },
): Promise<void> {
  if (ctx.silent || input.recipients.length === 0) return;
  await exec
    .insertInto("notifications")
    .values(
      input.recipients.map((recipientId) => ({
        id: ctx.genId(),
        recipient_id: recipientId,
        event_type: "issue.mentioned",
        project_id: input.projectId,
        title: `Mentioned in ${input.issueKey}`,
        occurred_at: input.occurredAt,
        target_type: "comment",
        target_id: input.commentId,
      })),
    )
    .execute();
}
