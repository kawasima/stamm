import { z } from "zod";
import { Id, PaginationParams, SortOrder } from "../schema/common.js";
import { IssueFilter } from "../schema/filter.js";
import {
  IssueBoardPosition,
  ProjectView,
  ViewLayout,
  ViewSortDirection,
  ViewVisibility,
} from "../schema/view.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Project View / Saved Query CRUD
// ============================================================

/** Create a saved view / query */
export const CreateProjectView = z.function()
  .args(z.object({
    actorId: Id,
    projectId: Id,
    ownerId: Id,
    name: z.string().min(1).max(200),
    layout: ViewLayout.optional(),
    filter: IssueFilter,
    groupBy: z.string().max(100).optional(),
    sortBy: z.string().max(100).optional(),
    sortDirection: ViewSortDirection.optional(),
    columns: z.array(z.string()).optional(),
    visibility: ViewVisibility.optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(ProjectView));

/** Get a view by ID */
export const GetProjectView = z.function()
  .args(z.object({ viewId: Id }))
  .returns(z.promise(ProjectView));

/** Update a view */
export const UpdateProjectView = z.function()
  .args(z.object({
    actorId: Id,
    viewId: Id,
    name: z.string().min(1).max(200).optional(),
    layout: ViewLayout.optional(),
    filter: IssueFilter.optional(),
    groupBy: z.string().max(100).optional(),
    sortBy: z.string().max(100).optional(),
    sortDirection: ViewSortDirection.optional(),
    columns: z.array(z.string()).optional(),
    visibility: ViewVisibility.optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(ProjectView));

/** Delete a view */
export const DeleteProjectView = z.function()
  .args(z.object({ actorId: Id, viewId: Id }))
  .returns(z.promise(z.void()));

/** List views accessible in a project (shared + the viewer's own private ones) */
export const ListProjectViews = z.function()
  .args(z.object({
    projectId: Id,
    ownerId: Id.optional(),
    visibility: ViewVisibility.optional(),
    layout: ViewLayout.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(ProjectView)));

// ============================================================
// Board card ordering
// ============================================================

/**
 * Reorder a card within a board view. This only changes ordering; the card's
 * column is derived from the issue's groupBy field. To move a card across
 * columns, change that field through its own behavior (e.g. TransitionIssueStatus),
 * then optionally call this to set the slot. Provide exactly one of
 * beforeIssueId / afterIssueId / position to express the target slot.
 */
export const MoveIssueOnBoard = z.function()
  .args(z.object({
    actorId: Id,
    viewId: Id,
    issueId: Id,
    beforeIssueId: Id.optional(),
    afterIssueId: Id.optional(),
    position: z.number().optional(),
  }))
  .returns(z.promise(IssueBoardPosition));

/** List card positions for a board view */
export const ListBoardPositions = z.function()
  .args(z.object({
    viewId: Id,
  }))
  .returns(z.promise(z.object({
    positions: z.array(IssueBoardPosition),
  })));
