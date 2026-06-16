import { z } from "zod";
import { Id, Resource, SortOrder } from "./common.js";
import { IssueFilter } from "./filter.js";

// ============================================================
// Automation Rules (GitHub Projects built-in workflows)
//
// Reactive "when <trigger> [and <condition>] then <action>" rules. Distinct
// from WorkflowTransition, which only gates which manual status transitions
// are allowed. Executing a rule produces the corresponding domain events
// (Assignment, IssueStatusChange, Labeling, ...) and an ActivityEntry.
// ============================================================

export const AutomationTrigger = z.enum([
  "issue.created",
  "issue.status_changed",
  "issue.assigned",
  "issue.labeled",
  "issue.closed",
  "issue.added_to_iteration",
  "item.added_to_view",
]);

export const AutomationActionType = z.enum([
  "set_status",
  "set_assignee",
  "add_label",
  "remove_label",
  "set_iteration",
  "set_milestone",
  "set_priority",
  "close_issue",
  "reopen_issue",
]);

export const AutomationRule = Resource.extend({
  projectId: Id,
  name: z.string().min(1).max(200),
  trigger: AutomationTrigger,
  // Optional guard evaluated against the affected issue before acting.
  condition: IssueFilter.optional(),
  actionType: AutomationActionType,
  // Action-specific parameters, e.g. { statusId: "..." } or { labelId: "..." }.
  actionParams: z.record(z.string()).default({}),
  enabled: z.boolean().default(true),
  sortOrder: SortOrder,
});

export type AutomationTrigger = z.infer<typeof AutomationTrigger>;
export type AutomationActionType = z.infer<typeof AutomationActionType>;
export type AutomationRule = z.infer<typeof AutomationRule>;
