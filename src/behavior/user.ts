import { z } from "zod";
import { Id, PaginationParams } from "../schema/common.js";
import {
  User,
  PublicUser,
  UserCategory,
  UserKind,
  UserStatus,
  UserGroup,
} from "../schema/user.js";
import { GroupMembership } from "../schema/intersection.js";
import { PaginatedResult, SortDirection } from "./common.js";

// ============================================================
// User CRUD
// ============================================================

/** Create a new user account */
export const CreateUser = z.function()
  .args(z.object({
    actorId: Id,
    login: z.string().min(1).max(100),
    email: z.string().email(),
    displayName: z.string().min(1).max(200),
    avatarUrl: z.string().url().optional(),
    language: z.string().optional(),
    kind: UserKind.optional(),
  }))
  .returns(z.promise(User));

/** Get a user by ID. `email` is returned only to a global admin or the user
 *  themselves; pass `actorId` to be recognized. */
export const GetUser = z.function()
  .args(z.object({ actorId: Id.optional(), userId: Id }))
  .returns(z.promise(PublicUser));

/** Get a user by login name */
export const GetUserByLogin = z.function()
  .args(z.object({ login: z.string() }))
  .returns(z.promise(User));

/** Update user profile fields */
export const UpdateUser = z.function()
  .args(z.object({
    actorId: Id,
    userId: Id,
    displayName: z.string().min(1).max(200).optional(),
    email: z.string().email().optional(),
    avatarUrl: z.string().url().optional(),
    language: z.string().optional(),
    kind: UserKind.optional(),
  }))
  .returns(z.promise(User));

/** Delete a user */
export const DeleteUser = z.function()
  .args(z.object({ actorId: Id, userId: Id }))
  .returns(z.promise(z.void()));

/** List users with filtering and pagination. `email` is included only for a
 *  global admin viewer (pass `actorId`); other callers get the public projection. */
export const ListUsers = z.function()
  .args(z.object({
    actorId: Id.optional(),
    status: UserStatus.optional(),
    kind: UserKind.optional(),
    query: z.string().optional(),
    sortBy: z.enum(["login", "displayName", "email"]).optional(),
    sortDirection: SortDirection.optional(),
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(PublicUser)));

// ============================================================
// User Status (Activate / Deactivate)
// ============================================================

/** Activate or deactivate a user */
export const SetUserStatus = z.function()
  .args(z.object({
    actorId: Id,
    userId: Id,
    status: UserStatus,
  }))
  .returns(z.promise(UserCategory));

/**
 * Get a user's account status (active/inactive). Readable by any authenticated
 * caller: account status is a shared collaboration signal (e.g. don't assign
 * work to a deactivated account), and the directory itself is already visible to
 * members. `actorId` is carried so the read is identified and can be tightened
 * later, but it is not gated on today.
 */
export const GetUserStatus = z.function()
  .args(z.object({ actorId: Id.optional(), userId: Id }))
  .returns(z.promise(UserCategory));

// ============================================================
// User Groups
// ============================================================

/** Create a user group */
export const CreateUserGroup = z.function()
  .args(z.object({
    actorId: Id,
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
  }))
  .returns(z.promise(UserGroup));

/** Get a user group by ID */
export const GetUserGroup = z.function()
  .args(z.object({ groupId: Id }))
  .returns(z.promise(UserGroup));

/** Update a user group */
export const UpdateUserGroup = z.function()
  .args(z.object({
    actorId: Id,
    groupId: Id,
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
  }))
  .returns(z.promise(UserGroup));

/** Delete a user group */
export const DeleteUserGroup = z.function()
  .args(z.object({ actorId: Id, groupId: Id }))
  .returns(z.promise(z.void()));

/** List all user groups */
export const ListUserGroups = z.function()
  .args(z.object({ pagination: PaginationParams }))
  .returns(z.promise(PaginatedResult(UserGroup)));

// ============================================================
// Group Membership
// ============================================================

/** Add a user to a group */
export const AddGroupMember = z.function()
  .args(z.object({
    actorId: Id,
    groupId: Id,
    userId: Id,
  }))
  .returns(z.promise(GroupMembership));

/** Remove a user from a group */
export const RemoveGroupMember = z.function()
  .args(z.object({
    actorId: Id,
    groupId: Id,
    userId: Id,
  }))
  .returns(z.promise(z.void()));

/** List members of a group. `email` is included only for a global admin viewer
 *  (pass `actorId`); other callers get the public projection. */
export const ListGroupMembers = z.function()
  .args(z.object({
    actorId: Id.optional(),
    groupId: Id,
    pagination: PaginationParams,
  }))
  .returns(z.promise(PaginatedResult(PublicUser)));
