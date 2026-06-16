import { z } from "zod";
import { Id, Resource, SortOrder } from "./common.js";
import { IssueFilter } from "./filter.js";

// ============================================================
// Project Views / Saved Queries
//
// Unifies Redmine custom queries and GitHub Projects views. A saved view is
// a named, reusable (filter + grouping + sort + columns + layout) bundle.
// visibility=private + ownerId is a personal query; visibility=public is a
// shared query. Cross-project breadth is expressed via filter.projectIds.
// ============================================================

export const ViewLayout = z.enum(["table", "board", "roadmap"]);
export const ViewVisibility = z.enum(["public", "private"]);
export const ViewSortDirection = z.enum(["asc", "desc"]);

export const ProjectView = Resource.extend({
  projectId: Id,
  ownerId: Id,
  name: z.string().min(1).max(200),
  layout: ViewLayout.default("table"),
  filter: IssueFilter,
  // Field key used to group rows / form board columns (e.g. "statusId").
  groupBy: z.string().max(100).optional(),
  sortBy: z.string().max(100).optional(),
  sortDirection: ViewSortDirection.default("asc"),
  // Ordered list of field keys to display as columns.
  columns: z.array(z.string()).default([]),
  visibility: ViewVisibility.default("private"),
  sortOrder: SortOrder,
});

// ============================================================
// Board card ordering
//
// Manual ordering of a card within a board view. We intentionally do NOT
// store which column the card is in: the column is derived at read time from
// the ProjectView.groupBy field of the issue (e.g. its statusId). Storing the
// column here would duplicate Issue.statusId and drift out of sync. This
// resource carries only `position` — the one fact not derivable from the issue
// — so reordering is the single allowed update. Cross-column moves are not
// expressed here; they change the underlying field via the proper behavior
// (e.g. TransitionIssueStatus).
// ============================================================

export const IssueBoardPosition = Resource.extend({
  viewId: Id,
  issueId: Id,
  position: z.number(),
});

export type ViewLayout = z.infer<typeof ViewLayout>;
export type ViewVisibility = z.infer<typeof ViewVisibility>;
export type ViewSortDirection = z.infer<typeof ViewSortDirection>;
export type ProjectView = z.infer<typeof ProjectView>;
export type IssueBoardPosition = z.infer<typeof IssueBoardPosition>;
