import { z } from "zod";
import { Id, MarkdownContent, Resource, Slug } from "./common.js";

// ============================================================
// Resources (R)
// WikiPage body is updatable (same approach as Issue/Milestone)
// ============================================================

export const Wiki = Resource.extend({
  projectId: Id,
});

export const WikiPageStatus = z.enum(["editable", "locked"]);

export const WikiPage = Resource.extend({
  wikiId: Id,
  title: z.string().min(1).max(300),
  slug: Slug,
  body: MarkdownContent,
  parentPageId: Id.optional(),
  version: z.number().int().positive(),
  status: WikiPageStatus.default("editable"),
});

export type Wiki = z.infer<typeof Wiki>;
export type WikiPageStatus = z.infer<typeof WikiPageStatus>;
export type WikiPage = z.infer<typeof WikiPage>;
