import { z } from "zod";
import { DateString, Id, LongTermEvent, SortOrder } from "./common.js";

// ============================================================
// Milestone - Long-Term Event
// All fields are on the body (updatable, same as Issue)
// ============================================================

export const MilestoneStatus = z.enum(["open", "closed", "locked"]);

export const Milestone = LongTermEvent.extend({
  projectId: Id,
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: MilestoneStatus.default("open"),
  startDate: DateString.optional(),
  dueDate: DateString.optional(),
  releaseDate: DateString.optional(),
  sortOrder: SortOrder,
});

export type MilestoneStatus = z.infer<typeof MilestoneStatus>;
export type Milestone = z.infer<typeof Milestone>;
