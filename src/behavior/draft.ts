import { z } from "zod";
import { Id, MarkdownContent, PaginationParams, SortOrder } from "../schema/common.js";
import { DraftConversion, DraftIssue } from "../schema/draft.js";
import { Issue } from "../schema/issue.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Draft Issue CRUD
// ============================================================

/** Create a draft issue on a project board */
export const CreateDraftIssue = z.function()
  .args(z.object({
    projectId: Id,
    title: z.string().min(1).max(500),
    body: MarkdownContent.optional(),
    actorId: Id,
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(DraftIssue));

/** Get a draft issue by ID */
export const GetDraftIssue = z.function()
  .args(z.object({ draftId: Id }))
  .returns(z.promise(DraftIssue));

/** Update a draft issue */
export const UpdateDraftIssue = z.function()
  .args(z.object({
    actorId: Id,
    draftId: Id,
    title: z.string().min(1).max(500).optional(),
    body: MarkdownContent.optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(DraftIssue));

/** Delete a draft issue */
export const DeleteDraftIssue = z.function()
  .args(z.object({ actorId: Id, draftId: Id }))
  .returns(z.promise(z.void()));

/** List draft issues in a project */
export const ListDraftIssues = z.function()
  .args(z.object({
    projectId: Id,
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(DraftIssue)));

/**
 * Promote a draft into a real issue. Creates the Issue and records a
 * DraftConversion event linking the draft to the new issue.
 */
export const ConvertDraftToIssue = z.function()
  .args(z.object({
    draftId: Id,
    issueTypeId: Id,
    priorityId: Id,
    statusId: Id.optional(),
    actorId: Id,
  }))
  .returns(z.promise(z.object({
    issue: Issue,
    conversion: DraftConversion,
  })));
