import {
  Project,
  ProjectCategory,
  ProjectHierarchy,
} from "../../schema/index.js";
import { ProjectMembership } from "../../schema/intersection.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { ConflictError, NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { buildPage, decodeCursor } from "../pagination.js";
import { assertGlobalAdmin } from "../permissions.js";

type ProjectMethods =
  | "createProject" | "getProject" | "getProjectByIdentifier" | "updateProject" | "deleteProject" | "listProjects"
  | "archiveProject" | "unarchiveProject" | "setProjectVisibility" | "setProjectParent"
  | "listProjectMembers" | "addProjectMember" | "updateProjectMember" | "removeProjectMember";

export function projectBehaviors(ctx: Ctx): Pick<Behaviors, ProjectMethods> {
  const db = ctx.db;
  const projectCodec = makeCodec(Project);
  const categoryCodec = makeCodec(ProjectCategory);
  const hierarchyCodec = makeCodec(ProjectHierarchy);

  // ProjectMembership.roleIds is normalized into project_membership_roles; the
  // membership value is assembled (decoded) from the membership row + its role rows.
  const writeRoles = async (
    trx: typeof db,
    membershipId: string,
    roleIds: string[],
  ): Promise<void> => {
    await trx.deleteFrom("project_membership_roles").where("membership_id", "=", membershipId).execute();
    for (const roleId of roleIds) {
      await trx.insertInto("project_membership_roles").values({ id: ctx.genId(), membership_id: membershipId, role_id: roleId }).execute();
    }
  };

  const loadCategory = async (projectId: string): Promise<ProjectCategory> => {
    const row = await db.selectFrom("project_categories").selectAll().where("project_id", "=", projectId).executeTakeFirst();
    if (!row) throw new NotFoundError("Project", projectId);
    return categoryCodec.decode(row);
  };

  const setCategory = async (cat: ProjectCategory): Promise<ProjectCategory> => {
    await db.updateTable("project_categories").set(categoryCodec.encode(cat) as never).where("id", "=", cat.id).execute();
    return cat;
  };

  const impl: Pick<Behaviors, ProjectMethods> = {
    createProject: async (args) => {
      await assertGlobalAdmin(ctx, args.actorId);
      const project = Project.parse({
        id: ctx.genId(),
        identifier: args.identifier,
        name: args.name,
        description: args.description,
      });
      await db.transaction().execute(async (trx) => {
        await trx.insertInto("projects").values(projectCodec.encode(project) as never).execute();
        const category = ProjectCategory.parse({
          id: ctx.genId(),
          projectId: project.id,
          visibility: args.visibility ?? "public",
          lifecycle: "active",
        });
        await trx.insertInto("project_categories").values(categoryCodec.encode(category) as never).execute();
        if (args.parentProjectId) {
          const h = ProjectHierarchy.parse({ id: ctx.genId(), parentProjectId: args.parentProjectId, childProjectId: project.id });
          await trx.insertInto("project_hierarchies").values(hierarchyCodec.encode(h) as never).execute();
        }
      });
      return project;
    },

    getProject: async ({ projectId }) => {
      const row = await db.selectFrom("projects").selectAll().where("id", "=", projectId).executeTakeFirst();
      if (!row) throw new NotFoundError("Project", projectId);
      return projectCodec.decode(row);
    },

    getProjectByIdentifier: async ({ identifier }) => {
      // A lookup by natural key: absence is an ordinary outcome (it enables
      // get-or-create), not an error. Return null rather than throwing.
      const row = await db.selectFrom("projects").selectAll().where("identifier", "=", identifier).executeTakeFirst();
      return row ? projectCodec.decode(row) : null;
    },

    updateProject: async ({ actorId, projectId, name, description }) => {
      await assertGlobalAdmin(ctx, actorId);
      const row = await db.selectFrom("projects").selectAll().where("id", "=", projectId).executeTakeFirst();
      if (!row) throw new NotFoundError("Project", projectId);
      const current = projectCodec.decode(row);
      const merged = Project.parse({
        ...current,
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      });
      await db.updateTable("projects").set(projectCodec.encode(merged) as never).where("id", "=", projectId).execute();
      return merged;
    },

    deleteProject: async ({ actorId, projectId }) => {
      await assertGlobalAdmin(ctx, actorId);
      await db.transaction().execute(async (trx) => {
        const res = await trx.deleteFrom("projects").where("id", "=", projectId).executeTakeFirst();
        if (Number(res.numDeletedRows ?? 0) === 0) throw new NotFoundError("Project", projectId);
        await trx.deleteFrom("project_categories").where("project_id", "=", projectId).execute();
        await trx.deleteFrom("project_hierarchies").where("child_project_id", "=", projectId).execute();
        await trx.deleteFrom("project_hierarchies").where("parent_project_id", "=", projectId).execute();
        const memberIds = (await trx.selectFrom("project_memberships").select("id").where("project_id", "=", projectId).execute()).map((m) => m.id);
        if (memberIds.length) await trx.deleteFrom("project_membership_roles").where("membership_id", "in", memberIds).execute();
        await trx.deleteFrom("project_memberships").where("project_id", "=", projectId).execute();
      });
    },

    listProjects: async (args) => {
      const limit = args.pagination?.limit ?? 20;
      const cursor = decodeCursor(args.pagination?.cursor);
      // project_categories is 1:1 with projects, so an inner join is safe and
      // lets visibility/lifecycle filter without correlated-subquery typing pain.
      let q = db
        .selectFrom("projects")
        .innerJoin("project_categories", "project_categories.project_id", "projects.id")
        .selectAll("projects");

      if (args.visibility) q = q.where("project_categories.visibility", "=", args.visibility);
      if (args.lifecycle) q = q.where("project_categories.lifecycle", "=", args.lifecycle);
      if (args.parentProjectId) {
        q = q
          .innerJoin("project_hierarchies", "project_hierarchies.child_project_id", "projects.id")
          .where("project_hierarchies.parent_project_id", "=", args.parentProjectId);
      }
      if (args.memberUserId) {
        q = q
          .innerJoin("project_memberships", "project_memberships.project_id", "projects.id")
          .where("project_memberships.user_id", "=", args.memberUserId);
      }
      if (args.query) {
        const like = `%${args.query}%`;
        q = q.where((eb) => eb.or([eb("projects.name", "like", like), eb("projects.identifier", "like", like)]));
      }
      if (cursor) q = q.where("projects.id", ">", cursor);

      const rows = await q.orderBy("projects.id").limit(limit + 1).execute();
      const page = buildPage(rows.map((r) => projectCodec.decode(r)), (p) => p.id, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    archiveProject: async ({ actorId, projectId }) => {
      await assertGlobalAdmin(ctx, actorId);
      return setCategory({ ...(await loadCategory(projectId)), lifecycle: "archived" });
    },
    unarchiveProject: async ({ actorId, projectId }) => {
      await assertGlobalAdmin(ctx, actorId);
      return setCategory({ ...(await loadCategory(projectId)), lifecycle: "active" });
    },
    setProjectVisibility: async ({ actorId, projectId, visibility }) => {
      await assertGlobalAdmin(ctx, actorId);
      return setCategory({ ...(await loadCategory(projectId)), visibility });
    },

    setProjectParent: async ({ actorId, childProjectId, parentProjectId }) => {
      await assertGlobalAdmin(ctx, actorId);
      const h = ProjectHierarchy.parse({ id: ctx.genId(), parentProjectId, childProjectId });
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom("project_hierarchies").where("child_project_id", "=", childProjectId).execute();
        await trx.insertInto("project_hierarchies").values(hierarchyCodec.encode(h) as never).execute();
      });
      return h;
    },

    addProjectMember: async ({ actorId, projectId, userId, roleIds }) => {
      await assertGlobalAdmin(ctx, actorId);
      const existing = await db.selectFrom("project_memberships").select("id").where("project_id", "=", projectId).where("user_id", "=", userId).executeTakeFirst();
      if (existing) throw new ConflictError(`User ${userId} is already a member of project ${projectId}`);
      const id = ctx.genId();
      await db.transaction().execute(async (trx) => {
        await trx.insertInto("project_memberships").values({ id, project_id: projectId, user_id: userId }).execute();
        await writeRoles(trx as typeof db, id, roleIds);
      });
      return ProjectMembership.parse({ id, projectId, userId, roleIds });
    },

    updateProjectMember: async ({ actorId, projectId, userId, roleIds }) => {
      await assertGlobalAdmin(ctx, actorId);
      const row = await db.selectFrom("project_memberships").selectAll().where("project_id", "=", projectId).where("user_id", "=", userId).executeTakeFirst();
      if (!row) throw new NotFoundError("ProjectMembership", `${projectId}/${userId}`);
      await db.transaction().execute(async (trx) => writeRoles(trx as typeof db, row.id, roleIds));
      return ProjectMembership.parse({ id: row.id, projectId, userId, roleIds });
    },

    removeProjectMember: async ({ actorId, projectId, userId }) => {
      await assertGlobalAdmin(ctx, actorId);
      const row = await db.selectFrom("project_memberships").select("id").where("project_id", "=", projectId).where("user_id", "=", userId).executeTakeFirst();
      if (!row) throw new NotFoundError("ProjectMembership", `${projectId}/${userId}`);
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom("project_membership_roles").where("membership_id", "=", row.id).execute();
        await trx.deleteFrom("project_memberships").where("id", "=", row.id).execute();
      });
    },

    listProjectMembers: async ({ projectId, roleId, pagination }) => {
      const limit = pagination?.limit ?? 20;
      const cursor = decodeCursor(pagination?.cursor);
      let q = db.selectFrom("project_memberships").selectAll().where("project_id", "=", projectId);
      if (roleId) {
        q = q.where(({ exists, selectFrom }) =>
          exists(selectFrom("project_membership_roles").select("id").whereRef("project_membership_roles.membership_id", "=", "project_memberships.id").where("project_membership_roles.role_id", "=", roleId)),
        );
      }
      if (cursor) q = q.where("id", ">", cursor);
      const rows = await q.orderBy("id").limit(limit + 1).execute();
      const page = buildPage(rows, (r) => r.id, limit);
      // batch role rows for the page (no N+1)
      const ids = page.items.map((r) => r.id);
      const roleRows = ids.length
        ? await db.selectFrom("project_membership_roles").select(["membership_id", "role_id"]).where("membership_id", "in", ids).execute()
        : [];
      const byMembership = new Map<string, string[]>();
      for (const rr of roleRows) {
        const list = byMembership.get(rr.membership_id) ?? [];
        list.push(rr.role_id);
        byMembership.set(rr.membership_id, list);
      }
      const items = page.items.map((r) => ProjectMembership.parse({ id: r.id, projectId: r.project_id, userId: r.user_id, roleIds: byMembership.get(r.id) ?? [] }));
      return { items, nextCursor: page.nextCursor };
    },
  };

  return impl;
}
