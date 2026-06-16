import { z } from "zod";
import { Id, PaginationParams } from "../schema/common.js";
import { IssueRelation, IssueRelationType } from "../schema/issue-relation.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Issue Relation CRUD
// ============================================================

/** Create a relation between two issues */
export const CreateIssueRelation = z.function()
  .args(z.object({
    actorId: Id,
    issueId: Id,
    relatedIssueId: Id,
    relationType: IssueRelationType,
    delay: z.number().int().optional(),
  }))
  .returns(z.promise(IssueRelation));

/** Delete a relation */
export const DeleteIssueRelation = z.function()
  .args(z.object({ actorId: Id, relationId: Id }))
  .returns(z.promise(z.void()));

/** List relations for an issue */
export const ListIssueRelations = z.function()
  .args(z.object({
    issueId: Id,
    relationType: IssueRelationType.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(IssueRelation)));
