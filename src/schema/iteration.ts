import { z } from "zod";
import { DateString, Event, Id, Resource, SortOrder } from "./common.js";

// ============================================================
// Iteration (sprint)
//
// A recurring, time-boxed window — distinct from Milestone (a release marker).
// Issue<->Iteration assignment mirrors the Milestone pattern: a current-state
// resource (IssueIteration) plus a history event (IterationSetting).
// Story points are expressed via a custom field (integer/float), not a
// first-class column.
// ============================================================

export const Iteration = Resource.extend({
  projectId: Id,
  name: z.string().min(1).max(200),
  startDate: DateString,
  endDate: DateString,
  sortOrder: SortOrder,
});

/** Current iteration assignment (R) */
export const IssueIteration = Resource.extend({
  issueId: Id,
  iterationId: Id,
});

/** Iteration assignment (E) - history */
export const IterationSetting = Event.extend({
  issueId: Id,
  iterationId: Id,
  userId: Id,
});

export type Iteration = z.infer<typeof Iteration>;
export type IssueIteration = z.infer<typeof IssueIteration>;
export type IterationSetting = z.infer<typeof IterationSetting>;
