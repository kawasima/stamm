import { z } from "zod";
import { DateString, Hours, Id, Percentage } from "../schema/common.js";

// ============================================================
// Aggregated Statistics (read-only query behaviors)
//
// DEFERRED — not in the Behaviors interface, not exposed as MCP tools. Per
// ADR-0001 (docs/adr/0001-metrics-are-a-consumer-concern.md), stamm exposes
// primary observations and does not model metrics. The contracts below are
// metric-agnostic, configuration-grounded current-state rollups: admissible as
// server-side primitives ONLY when a consumer hits a scale wall that makes
// counting client-side over issue_search impractical. Until then they stay
// unimplemented and unexposed. Named/parameterized metrics (burndown) and
// observations already covered by issue_search filters (overdue) were removed —
// see the ADR and docs/metrics-cookbook.md.
// ============================================================

/** Get issue count by status category for a project or milestone */
export const GetIssueStatusSummary = z.function()
  .args(z.object({
    projectId: Id,
    milestoneId: Id.optional(),
  }))
  .returns(z.promise(z.object({
    todo: z.number().int(),
    inProgress: z.number().int(),
    done: z.number().int(),
    total: z.number().int(),
  })));

/** Get issue count grouped by issue type */
export const GetIssueTypeSummary = z.function()
  .args(z.object({ projectId: Id }))
  .returns(z.promise(z.object({
    groups: z.array(z.object({
      issueTypeId: Id,
      issueTypeName: z.string(),
      count: z.number().int(),
    })),
  })));

/** Get issue count grouped by priority */
export const GetIssuePrioritySummary = z.function()
  .args(z.object({ projectId: Id }))
  .returns(z.promise(z.object({
    groups: z.array(z.object({
      priorityId: Id,
      priorityName: z.string(),
      count: z.number().int(),
    })),
  })));

/** Get issue count grouped by assignee */
export const GetIssueAssigneeSummary = z.function()
  .args(z.object({ projectId: Id }))
  .returns(z.promise(z.object({
    groups: z.array(z.object({
      assigneeId: Id,
      assigneeName: z.string(),
      count: z.number().int(),
    })),
    unassigned: z.number().int(),
  })));

/** Get time tracking summary for a project */
export const GetProjectTimeSummary = z.function()
  .args(z.object({
    projectId: Id,
    spentOnFrom: DateString.optional(),
    spentOnTo: DateString.optional(),
  }))
  .returns(z.promise(z.object({
    totalSpentHours: Hours,
    totalEstimatedHours: Hours,
    averageDoneRatio: Percentage,
  })));
