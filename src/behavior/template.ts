import { z } from "zod";
import { Id, MarkdownContent, PaginationParams, SortOrder } from "../schema/common.js";
import { CustomFieldValue } from "../schema/custom-field.js";
import { IssueTemplate } from "../schema/template.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Issue Template CRUD
// ============================================================

/** Create an issue template */
export const CreateIssueTemplate = z.function()
  .args(z.object({
    actorId: Id,
    projectId: Id,
    name: z.string().min(1).max(200),
    issueTypeId: Id.optional(),
    titlePrefix: z.string().max(200).optional(),
    descriptionTemplate: MarkdownContent,
    defaultPriorityId: Id.optional(),
    defaultLabelIds: z.array(Id).optional(),
    defaultAssigneeIds: z.array(Id).optional(),
    defaultCustomFields: z.array(CustomFieldValue).optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(IssueTemplate));

/** Get an issue template by ID */
export const GetIssueTemplate = z.function()
  .args(z.object({ templateId: Id }))
  .returns(z.promise(IssueTemplate));

/** Update an issue template */
export const UpdateIssueTemplate = z.function()
  .args(z.object({
    actorId: Id,
    templateId: Id,
    name: z.string().min(1).max(200).optional(),
    issueTypeId: Id.optional(),
    titlePrefix: z.string().max(200).optional(),
    descriptionTemplate: MarkdownContent.optional(),
    defaultPriorityId: Id.optional(),
    defaultLabelIds: z.array(Id).optional(),
    defaultAssigneeIds: z.array(Id).optional(),
    defaultCustomFields: z.array(CustomFieldValue).optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(IssueTemplate));

/** Delete an issue template */
export const DeleteIssueTemplate = z.function()
  .args(z.object({ actorId: Id, templateId: Id }))
  .returns(z.promise(z.void()));

/** List issue templates in a project */
export const ListIssueTemplates = z.function()
  .args(z.object({
    projectId: Id,
    issueTypeId: Id.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(IssueTemplate)));

/**
 * Build CreateIssue arguments from a template (merging caller overrides).
 * Returns the prepared fields rather than persisting, so the caller drives
 * the actual CreateIssue call.
 */
export const InstantiateTemplate = z.function()
  .args(z.object({
    templateId: Id,
    subject: z.string().min(1).max(500).optional(),
  }))
  .returns(z.promise(z.object({
    projectId: Id,
    issueTypeId: Id.optional(),
    subject: z.string(),
    description: MarkdownContent.optional(),
    priorityId: Id.optional(),
    labelIds: z.array(Id).optional(),
    assigneeIds: z.array(Id).optional(),
    customFields: z.array(CustomFieldValue).optional(),
  })));
