import { z } from "zod";
import { Id, Resource, Slug } from "./common.js";

export const Project = Resource.extend({
  identifier: Slug,
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
});

export const ProjectHierarchy = Resource.extend({
  parentProjectId: Id,
  childProjectId: Id,
});

export const ProjectVisibility = z.enum(["public", "private"]);
export const ProjectLifecycle = z.enum(["active", "archived"]);

export const ProjectCategory = Resource.extend({
  projectId: Id,
  visibility: ProjectVisibility,
  lifecycle: ProjectLifecycle.default("active"),
});

export type Project = z.infer<typeof Project>;
export type ProjectHierarchy = z.infer<typeof ProjectHierarchy>;
export type ProjectVisibility = z.infer<typeof ProjectVisibility>;
export type ProjectLifecycle = z.infer<typeof ProjectLifecycle>;
export type ProjectCategory = z.infer<typeof ProjectCategory>;
