import type { Kysely } from "kysely";
import type { Database } from "./db/schema.js";
import type { Ctx } from "./ctx.js";
import { appendActivity } from "./timeline.js";

/**
 * Typed change events for the metrics-bearing satellites whose history cannot be
 * reconstructed from current state plus the status timeline (schedule, estimate).
 * Each records an append-only event row (the from→to values metrics need) AND a
 * marker on the activity feed — the same split transitionIssueStatus uses for
 * status (issue_status_changes + a status_changed activity). Both are no-ops when
 * nothing actually changed, so we never record a meaningless event.
 *
 * `exec` is the db or a transaction, so these compose inside the atomic write
 * that produced the change.
 */

const day = (v?: string | null): string | null => v ?? null;

export async function recordScheduleChange(
  ctx: Ctx,
  exec: Kysely<Database>,
  args: {
    issueId: string;
    projectId: string;
    userId: string;
    from: { startDate?: string | null; dueDate?: string | null };
    to: { startDate?: string | null; dueDate?: string | null };
    occurredAt?: string;
  },
): Promise<void> {
  const { from, to } = args;
  if (day(from.startDate) === day(to.startDate) && day(from.dueDate) === day(to.dueDate)) return;
  const occurredAt = args.occurredAt ?? ctx.now();
  await exec
    .insertInto("issue_schedule_changes")
    .values({
      id: ctx.genId(),
      issue_id: args.issueId,
      user_id: args.userId,
      occurred_at: occurredAt,
      from_start_date: day(from.startDate),
      to_start_date: day(to.startDate),
      from_due_date: day(from.dueDate),
      to_due_date: day(to.dueDate),
    })
    .execute();
  await appendActivity(ctx, exec, { projectId: args.projectId, userId: args.userId, action: "scheduled", targetType: "issue", targetId: args.issueId, occurredAt });
}

export async function recordEstimationChange(
  ctx: Ctx,
  exec: Kysely<Database>,
  args: { issueId: string; projectId: string; userId: string; fromHours?: number | null; toHours: number; occurredAt?: string },
): Promise<void> {
  const fromHours = args.fromHours ?? null;
  if (fromHours === args.toHours) return;
  const occurredAt = args.occurredAt ?? ctx.now();
  await exec
    .insertInto("issue_estimation_changes")
    .values({ id: ctx.genId(), issue_id: args.issueId, user_id: args.userId, occurred_at: occurredAt, from_hours: fromHours, to_hours: args.toHours })
    .execute();
  await appendActivity(ctx, exec, { projectId: args.projectId, userId: args.userId, action: "estimated", targetType: "issue", targetId: args.issueId, occurredAt });
}
