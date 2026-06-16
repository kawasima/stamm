import { z } from "zod";
import { EmailAddress, Id, Resource, UrlString } from "./common.js";

// ============================================================
// Resources (R)
// ============================================================

export const Permission = z.enum([
  "project.create",
  "project.update",
  "project.delete",
  "project.archive",
  "issue.create",
  "issue.update",
  "issue.delete",
  "issue.assign",
  "issue.move",
  "comment.create",
  "comment.update",
  "comment.delete",
  "attachment.create",
  "attachment.delete",
  "wiki.create",
  "wiki.update",
  "wiki.delete",
  "time_entry.create",
  "time_entry.update",
  "time_entry.delete",
  "milestone.manage",
  "iteration.manage",
  "custom_field.manage",
  "view.manage",
  "automation.manage",
  "template.manage",
  "member.manage",
  "role.manage",
  "webhook.manage",
]);

/** How much of a project's issues a role can see (Redmine-style scoping) */
export const IssuesVisibility = z.enum(["all", "own_or_assigned"]);

export const Role = Resource.extend({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  permissions: z.array(Permission),
  issuesVisibility: IssuesVisibility.default("all"),
  builtinKind: z.enum(["admin", "member", "viewer"]).optional(),
});

export const UserKind = z.enum(["regular", "admin"]);

export const User = Resource.extend({
  login: z.string().min(1).max(100),
  email: EmailAddress,
  displayName: z.string().min(1).max(200),
  avatarUrl: UrlString.optional(),
  language: z.string().default("en"),
  kind: UserKind.default("regular"),
});

export const UserStatus = z.enum(["active", "inactive"]);

export const UserCategory = Resource.extend({
  userId: Id,
  status: UserStatus,
});

export const UserGroup = Resource.extend({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export type Permission = z.infer<typeof Permission>;
export type IssuesVisibility = z.infer<typeof IssuesVisibility>;
export type Role = z.infer<typeof Role>;
export type UserKind = z.infer<typeof UserKind>;
export type User = z.infer<typeof User>;
export type UserStatus = z.infer<typeof UserStatus>;
export type UserCategory = z.infer<typeof UserCategory>;
export type UserGroup = z.infer<typeof UserGroup>;
