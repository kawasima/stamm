import { z } from "zod";
import { DateString, Event, Hours, Id, Resource, SortOrder } from "./common.js";

// ============================================================
// Resource (R)
// ============================================================

export const TimeEntryActivity = Resource.extend({
  name: z.string().min(1).max(100),
  sortOrder: SortOrder,
});

// ============================================================
// Event (E) - logging time is an event
// ============================================================

export const TimeEntry = Event.extend({
  projectId: Id,
  issueId: Id.optional(),
  userId: Id,
  activityId: Id,
  hours: Hours,
  spentOn: DateString,
  comment: z.string().max(1000).optional(),
});

export type TimeEntryActivity = z.infer<typeof TimeEntryActivity>;
export type TimeEntry = z.infer<typeof TimeEntry>;
