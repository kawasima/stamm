import { z } from "zod";
import { Id, MarkdownContent, PaginationParams, Slug } from "../schema/common.js";
import { Wiki, WikiPage } from "../schema/wiki.js";
import { WikiStartPage } from "../schema/intersection.js";
import { PaginatedResult, SortDirection } from "./common.js";

// ============================================================
// Wiki (one per project)
// ============================================================

/** Create (enable) a wiki for a project */
export const CreateWiki = z.function()
  .args(z.object({ projectId: Id }))
  .returns(z.promise(Wiki));

/** Get the wiki for a project */
export const GetWiki = z.function()
  .args(z.object({ projectId: Id }))
  .returns(z.promise(Wiki));

/** Delete (disable) a wiki for a project */
export const DeleteWiki = z.function()
  .args(z.object({ projectId: Id }))
  .returns(z.promise(z.void()));

/** Set the start (home) page of a wiki */
export const SetWikiStartPage = z.function()
  .args(z.object({
    wikiId: Id,
    wikiPageId: Id,
  }))
  .returns(z.promise(WikiStartPage));

// ============================================================
// Wiki Pages
// ============================================================

/** Create a wiki page */
export const CreateWikiPage = z.function()
  .args(z.object({
    wikiId: Id,
    title: z.string().min(1).max(300),
    slug: Slug,
    body: MarkdownContent,
    parentPageId: Id.optional(),
  }))
  .returns(z.promise(WikiPage));

/** Get a wiki page by ID */
export const GetWikiPage = z.function()
  .args(z.object({ pageId: Id }))
  .returns(z.promise(WikiPage));

/** Get a wiki page by slug within a wiki */
export const GetWikiPageBySlug = z.function()
  .args(z.object({
    wikiId: Id,
    slug: Slug,
  }))
  .returns(z.promise(WikiPage));

/** Update a wiki page (creates a new version) */
export const UpdateWikiPage = z.function()
  .args(z.object({
    pageId: Id,
    title: z.string().min(1).max(300).optional(),
    body: MarkdownContent.optional(),
    parentPageId: Id.optional(),
  }))
  .returns(z.promise(WikiPage));

/** Delete a wiki page */
export const DeleteWikiPage = z.function()
  .args(z.object({ pageId: Id }))
  .returns(z.promise(z.void()));

/** Lock a wiki page */
export const LockWikiPage = z.function()
  .args(z.object({ pageId: Id }))
  .returns(z.promise(WikiPage));

/** Unlock a wiki page */
export const UnlockWikiPage = z.function()
  .args(z.object({ pageId: Id }))
  .returns(z.promise(WikiPage));

/** List wiki pages in a wiki */
export const ListWikiPages = z.function()
  .args(z.object({
    wikiId: Id,
    parentPageId: Id.optional(),
    query: z.string().optional(),
    sortBy: z.enum(["title", "version"]).optional(),
    sortDirection: SortDirection.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(WikiPage)));

/** Get the page tree (hierarchical structure) for a wiki */
export const GetWikiPageTree = z.function()
  .args(z.object({ wikiId: Id }))
  .returns(z.promise(z.object({
    pages: z.array(z.object({
      id: Id,
      title: z.string(),
      slug: Slug,
      parentPageId: Id.optional(),
      childCount: z.number().int(),
    })),
  })));
