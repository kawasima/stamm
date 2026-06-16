import type { Kysely } from "kysely";
import { ActivityEntry, type ActivityAction, type PropertyChange } from "../schema/index.js";
import type { Database } from "./db/schema.js";
import type { Ctx } from "./ctx.js";
import { makeCodec } from "./db/codec.js";

const activityCodec = makeCodec(ActivityEntry, { json: ["changes"] });

export interface ActivityInput {
  projectId: string;
  userId: string;
  action: ActivityAction;
  targetType: string;
  targetId: string;
  changes?: PropertyChange[];
  /** Override the timestamp so a multi-write mutation shares one occurredAt. */
  occurredAt?: string;
}

/**
 * Append one entry to the canonical timeline. `exec` is the db or a transaction
 * (a Kysely transaction is assignable to Kysely), so this composes inside the
 * atomic writes that produce it. Stamps id + occurredAt from the Ctx so a whole
 * mutation shares one timestamp.
 */
export async function appendActivity(ctx: Ctx, exec: Kysely<Database>, input: ActivityInput): Promise<void> {
  const entry = {
    id: ctx.genId(),
    projectId: input.projectId,
    userId: input.userId,
    action: input.action,
    changes: input.changes ?? [],
    occurredAt: input.occurredAt ?? ctx.now(),
    targetType: input.targetType,
    targetId: input.targetId,
  };
  await exec.insertInto("activity_entries").values(activityCodec.encode(entry) as never).execute();
}

/**
 * Derive createdAt/updatedAt for a target from its timeline: createdAt is the
 * `created` entry's occurredAt, updatedAt the latest entry's. ISO-8601 strings
 * compare correctly lexicographically. Returns `{}` if the target has no activity.
 */
export async function deriveTimestamps(
  exec: Kysely<Database>,
  targetType: string,
  targetId: string,
): Promise<{ createdAt?: string; updatedAt?: string }> {
  const rows = await exec
    .selectFrom("activity_entries")
    .select(["occurred_at as occurredAt", "action"])
    .where("target_type", "=", targetType)
    .where("target_id", "=", targetId)
    .execute();

  if (rows.length === 0) return {};
  const createdAt = rows.find((r) => r.action === "created")?.occurredAt;
  const updatedAt = rows.reduce((max, r) => (r.occurredAt > max ? r.occurredAt : max), rows[0].occurredAt);
  return { createdAt, updatedAt };
}
