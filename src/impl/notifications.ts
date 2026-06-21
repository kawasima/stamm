import type { Kysely } from "kysely";
import type { NotificationEventType } from "../schema/index.js";
import type { Database } from "./db/schema.js";
import type { Ctx } from "./ctx.js";

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
}

/**
 * Emit notifications as a side-effect of an issue write. Audience = author ∪
 * current assignees ∪ watchers (or `onlyRecipients` when given), minus the actor
 * (never notify yourself). Runs inside the triggering write's transaction.
 */
export async function notifyIssueEvent(ctx: Ctx, exec: Kysely<Database>, input: NotifyIssueInput): Promise<void> {
  let recipients: Set<string>;
  if (input.onlyRecipients) {
    recipients = new Set(input.onlyRecipients);
  } else {
    const assignees = (await exec.selectFrom("issue_assignees").select("assignee_id").where("issue_id", "=", input.issueId).execute()).map((r) => r.assignee_id);
    const watchers = (await exec.selectFrom("issue_watchers").select("user_id").where("issue_id", "=", input.issueId).execute()).map((r) => r.user_id);
    recipients = new Set([input.authorId, ...assignees, ...watchers]);
  }
  recipients.delete(input.actorId);
  if (recipients.size === 0) return;
  const occurredAt = input.occurredAt ?? ctx.now();
  // One multi-row insert instead of a round-trip per recipient: a heavily
  // watched issue would otherwise make every write O(watchers) statements
  // inside the triggering transaction.
  const rows = [...recipients].map((recipientId) => ({
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
