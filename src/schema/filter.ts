import { z } from "zod";
import { DateString, Id } from "./common.js";
import { IssueVisibility } from "./issue.js";
import { StatusCategory } from "./status.js";

// ============================================================
// Issue filter (shared value object)
//
// Lives in the schema layer so it can be reused both by query behaviors
// (ListIssues) and by persisted entities that embed a filter, such as
// ProjectView (saved views/queries).
// ============================================================

export const IssueFilter = z.object({
  projectId: Id.optional(),
  projectIds: z.array(Id).optional(),
  issueTypeIds: z.array(Id).optional(),
  statusIds: z.array(Id).optional(),
  statusCategories: z.array(StatusCategory).optional(),
  priorityIds: z.array(Id).optional(),
  assigneeIds: z.array(Id).optional(),
  authorId: Id.optional(),
  labelIds: z.array(Id).optional(),
  milestoneId: Id.optional(),
  iterationId: Id.optional(),
  categoryId: Id.optional(),
  parentIssueId: Id.optional(),
  watcherUserId: Id.optional(),
  visibility: IssueVisibility.optional(),
  // Time-based filters resolve against derived data, not Issue fields.
  // Issue carries no timestamp (Resources are timeless — see common.ts). These
  // are evaluated against the canonical timeline in ActivityEntry (activity.ts):
  //   created* -> ActivityEntry(action="created").occurredAt
  //   updated* -> the latest ActivityEntry.occurredAt
  // both scoped by targetType="issue" AND targetId=issue.id.
  createdAfter: DateString.optional(),
  createdBefore: DateString.optional(),
  updatedAfter: DateString.optional(),
  updatedBefore: DateString.optional(),
  // dueDate* / isOverdue resolve against IssueSchedule.dueDate (a separate
  // Resource, see issue.ts), not against the Issue body.
  dueDateFrom: DateString.optional(),
  dueDateTo: DateString.optional(),
  hasNoDueDate: z.boolean().optional(),
  isOverdue: z.boolean().optional(),
  customField: z.object({
    fieldId: Id,
    value: z.union([z.string(), z.number(), z.boolean()]),
  }).optional(),
  query: z.string().optional(),
});

export type IssueFilter = z.infer<typeof IssueFilter>;
