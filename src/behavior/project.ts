import { z } from "zod";
import { Id, PaginationParams, Slug } from "../schema/common.js";
import {
  Project,
  ProjectVisibility,
  ProjectLifecycle,
  ProjectCategory,
  ProjectHierarchy,
} from "../schema/project.js";
import { ProjectMembership } from "../schema/intersection.js";
import { PaginatedResult, SortDirection } from "./common.js";

// ============================================================
// Project CRUD
// ============================================================

/** Create a new project */
export const CreateProject = z.function()
  .args(z.object({
    actorId: Id,
    identifier: Slug,
    name: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    visibility: ProjectVisibility.optional(),
    parentProjectId: Id.optional(),
  }))
  .returns(z.promise(Project));

/** Get a project by ID */
export const GetProject = z.function()
  .args(z.object({ projectId: Id }))
  .returns(z.promise(Project));

/** Get a project by its slug identifier */
export const GetProjectByIdentifier = z.function()
  .args(z.object({ identifier: Slug }))
  .returns(z.promise(Project));

/** Update a project */
export const UpdateProject = z.function()
  .args(z.object({
    actorId: Id,
    projectId: Id,
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
  }))
  .returns(z.promise(Project));

/** Delete a project and all associated data */
export const DeleteProject = z.function()
  .args(z.object({ actorId: Id, projectId: Id }))
  .returns(z.promise(z.void()));

/** List projects with filtering */
export const ListProjects = z.function()
  .args(z.object({
    visibility: ProjectVisibility.optional(),
    lifecycle: ProjectLifecycle.optional(),
    parentProjectId: Id.optional(),
    memberUserId: Id.optional(),
    query: z.string().optional(),
    sortBy: z.enum(["name", "identifier"]).optional(),
    sortDirection: SortDirection.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(Project)));

// ============================================================
// Project Lifecycle
// ============================================================

/** Archive a project */
export const ArchiveProject = z.function()
  .args(z.object({ actorId: Id, projectId: Id }))
  .returns(z.promise(ProjectCategory));

/** Unarchive (reactivate) a project */
export const UnarchiveProject = z.function()
  .args(z.object({ actorId: Id, projectId: Id }))
  .returns(z.promise(ProjectCategory));

/** Change project visibility */
export const SetProjectVisibility = z.function()
  .args(z.object({
    actorId: Id,
    projectId: Id,
    visibility: ProjectVisibility,
  }))
  .returns(z.promise(ProjectCategory));

// ============================================================
// Project Hierarchy (Redmine nested projects)
// ============================================================

/** Set parent of a project */
export const SetProjectParent = z.function()
  .args(z.object({
    actorId: Id,
    childProjectId: Id,
    parentProjectId: Id,
  }))
  .returns(z.promise(ProjectHierarchy));

/** Remove parent relationship */
export const RemoveProjectParent = z.function()
  .args(z.object({ actorId: Id, childProjectId: Id }))
  .returns(z.promise(z.void()));

/** Get sub-projects of a project */
export const ListSubProjects = z.function()
  .args(z.object({
    projectId: Id,
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(Project)));

/** Get ancestor chain (for breadcrumb) */
export const GetProjectAncestors = z.function()
  .args(z.object({ projectId: Id }))
  .returns(z.promise(z.object({ ancestors: z.array(Project) })));

// ============================================================
// Project Membership
// ============================================================

/** Add a member to a project with specified roles */
export const AddProjectMember = z.function()
  .args(z.object({
    actorId: Id,
    projectId: Id,
    userId: Id,
    roleIds: z.array(Id).min(1),
  }))
  .returns(z.promise(ProjectMembership));

/** Update a member's roles in a project */
export const UpdateProjectMember = z.function()
  .args(z.object({
    actorId: Id,
    projectId: Id,
    userId: Id,
    roleIds: z.array(Id).min(1),
  }))
  .returns(z.promise(ProjectMembership));

/** Remove a member from a project */
export const RemoveProjectMember = z.function()
  .args(z.object({
    actorId: Id,
    projectId: Id,
    userId: Id,
  }))
  .returns(z.promise(z.void()));

/** List members of a project */
export const ListProjectMembers = z.function()
  .args(z.object({
    projectId: Id,
    roleId: Id.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(ProjectMembership)));
