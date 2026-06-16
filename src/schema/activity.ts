import { z } from "zod";
import { Id, TargetRef, Timestamp } from "./common.js";

export const ActivityAction = z.enum([
  "created",
  "updated",
  "deleted",
  "status_changed",
  "assigned",
  "commented",
  "labeled",
  "unlabeled",
  "categorized",
  "milestone_set",
  "iteration_set",
  "scheduled",
  "estimated",
  "progress_updated",
  "closed",
  "reopened",
  "automation_executed",
  "draft_converted",
]);

export const PropertyChange = z.object({
  field: z.string(),
  oldValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  newValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

/**
 * Activity entry (E) - append-only audit log.
 *
 * This is the canonical timeline of the system: every mutation implicitly
 * emits one entry (action + actor + occurredAt + targetRef). It is also the
 * single source of truth for an entity's createdAt / updatedAt, which are NOT
 * stored on the entities themselves (Resources are timeless — see common.ts):
 *   createdAt = entry with action="created" for that target (.occurredAt)
 *   updatedAt = the most recent entry for that target (.occurredAt)
 * Derivation query: WHERE targetType=… AND targetId=…
 *
 * `userId` is required: it is the acting principal (the `actorId` passed to the
 * mutating behavior). This is why every mutation contract carries an actorId.
 */
export const ActivityEntry = z.object({
  id: Id,
  projectId: Id,
  userId: Id,
  action: ActivityAction,
  changes: z.array(PropertyChange).default([]),
  occurredAt: Timestamp,
}).merge(TargetRef);

export type ActivityAction = z.infer<typeof ActivityAction>;
export type PropertyChange = z.infer<typeof PropertyChange>;
export type ActivityEntry = z.infer<typeof ActivityEntry>;
