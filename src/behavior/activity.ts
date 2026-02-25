import { z } from "zod";
import { DateString, Id, PaginationParams } from "../schema/common.js";
import { ActivityEntry, ActivityAction } from "../schema/activity.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Activity Log (read-only — entries are created implicitly by other operations)
// ============================================================

/** List activity entries (project-scoped activity feed) */
export const ListActivities = z.function()
  .args(z.object({
    projectId: Id.optional(),
    userId: Id.optional(),
    action: ActivityAction.optional(),
    targetType: z.string().optional(),
    targetId: Id.optional(),
    occurredAfter: DateString.optional(),
    occurredBefore: DateString.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(ActivityEntry)));

/** Get a single activity entry by ID */
export const GetActivity = z.function()
  .args(z.object({ activityId: Id }))
  .returns(z.promise(ActivityEntry));
