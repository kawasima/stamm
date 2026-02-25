import { z } from "zod";
import { Id, PaginationParams } from "../schema/common.js";
import { Role, Permission } from "../schema/user.js";
import { PaginatedResult } from "./common.js";

// ============================================================
// Role CRUD
// ============================================================

/** Create a role */
export const CreateRole = z.function()
  .args(z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    permissions: z.array(Permission),
    builtinKind: z.enum(["admin", "member", "viewer"]).optional(),
  }))
  .returns(z.promise(Role));

/** Get a role by ID */
export const GetRole = z.function()
  .args(z.object({ roleId: Id }))
  .returns(z.promise(Role));

/** Update a role */
export const UpdateRole = z.function()
  .args(z.object({
    roleId: Id,
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    permissions: z.array(Permission).optional(),
  }))
  .returns(z.promise(Role));

/** Delete a role */
export const DeleteRole = z.function()
  .args(z.object({ roleId: Id }))
  .returns(z.promise(z.void()));

/** List all roles */
export const ListRoles = z.function()
  .args(z.object({ pagination: PaginationParams }))
  .returns(z.promise(PaginatedResult(Role)));
