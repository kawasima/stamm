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
  "scheduled",
  "estimated",
  "progress_updated",
  "closed",
  "reopened",
]);

export const PropertyChange = z.object({
  field: z.string(),
  oldValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  newValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

/** Activity entry (E) - append-only audit log */
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
