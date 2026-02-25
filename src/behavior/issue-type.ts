import { z } from "zod";
import { HexColor, Id, PaginationParams, SortOrder } from "../schema/common.js";
import { IssueType, IssueTypeKind } from "../schema/issue-type.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Issue Type CRUD
// ============================================================

/** Create an issue type */
export const CreateIssueType = z.function()
  .args(z.object({
    name: z.string().min(1).max(100),
    color: HexColor.optional(),
    icon: z.string().max(50).optional(),
    description: z.string().max(500).optional(),
    kind: IssueTypeKind.optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(IssueType));

/** Get an issue type by ID */
export const GetIssueType = z.function()
  .args(z.object({ issueTypeId: Id }))
  .returns(z.promise(IssueType));

/** Update an issue type */
export const UpdateIssueType = z.function()
  .args(z.object({
    issueTypeId: Id,
    name: z.string().min(1).max(100).optional(),
    color: HexColor.optional(),
    icon: z.string().max(50).optional(),
    description: z.string().max(500).optional(),
    kind: IssueTypeKind.optional(),
    sortOrder: SortOrder.optional(),
  }))
  .returns(z.promise(IssueType));

/** Delete an issue type */
export const DeleteIssueType = z.function()
  .args(z.object({ issueTypeId: Id }))
  .returns(z.promise(z.void()));

/** List all issue types */
export const ListIssueTypes = z.function()
  .args(z.object({ pagination: PaginationParams }))
  .returns(z.promise(PaginatedResult(IssueType)));
