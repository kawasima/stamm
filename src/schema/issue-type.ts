import { z } from "zod";
import { HexColor, Resource, SortOrder } from "./common.js";

export const IssueTypeKind = z.enum(["standard", "subtask"]);

export const IssueType = Resource.extend({
  name: z.string().min(1).max(100),
  color: HexColor.optional(),
  icon: z.string().max(50).optional(),
  description: z.string().max(500).optional(),
  kind: IssueTypeKind.default("standard"),
  sortOrder: SortOrder,
});

export type IssueTypeKind = z.infer<typeof IssueTypeKind>;
export type IssueType = z.infer<typeof IssueType>;
