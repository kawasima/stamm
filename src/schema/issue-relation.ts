import { z } from "zod";
import { Id, Resource } from "./common.js";

export const IssueRelationType = z.enum([
  "relates_to",
  "duplicates",
  "duplicated_by",
  "blocks",
  "blocked_by",
  "precedes",
  "follows",
  "copied_from",
  "copied_to",
]);

export const IssueRelation = Resource.extend({
  issueId: Id,
  relatedIssueId: Id,
  relationType: IssueRelationType,
  delay: z.number().int().optional(),
});

export type IssueRelationType = z.infer<typeof IssueRelationType>;
export type IssueRelation = z.infer<typeof IssueRelation>;
