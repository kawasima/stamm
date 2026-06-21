import { ProjectView, IssueBoardPosition } from "../../schema/index.js";
import type { ProjectView as ProjectViewT, IssueBoardPosition as IssueBoardPositionT } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { ConflictError, NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { assertCanWrite, assertCanReadProject, isGlobalAdmin } from "../permissions.js";
import { buildPage, decodeCursor } from "../pagination.js";

type ViewMethods =
  | "createProjectView" | "getProjectView" | "updateProjectView" | "deleteProjectView"
  | "listProjectViews" | "moveIssueOnBoard" | "listBoardPositions";

/**
 * Saved views (named filter + grouping + sort + columns + layout) and the manual
 * card ordering for board layouts. Writes require `view.manage`; reads are open,
 * except list, which scopes private views to their owner. Board positions store
 * only `position` (the column is derived from the issue's groupBy field), and a
 * reorder picks a fractional midpoint between neighbors so siblings never shift.
 */
export function viewBehaviors(ctx: Ctx): Pick<Behaviors, ViewMethods> {
  const db = ctx.db;
  const codec = makeCodec(ProjectView, { json: ["filter", "columns"] });
  const posCodec = makeCodec(IssueBoardPosition);

  const load = async (id: string): Promise<ProjectViewT> => {
    const row = await db.selectFrom("project_views").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundError("ProjectView", id);
    return codec.decode(row);
  };

  /** A view is readable when the actor can read its project, and — for a private
   *  view — only by its owner (or a global admin). Throws NotFound otherwise. */
  const assertCanReadView = async (view: ProjectViewT, actorId: string): Promise<void> => {
    await assertCanReadProject(ctx, view.projectId, actorId);
    if (view.visibility === "private" && view.ownerId !== actorId && !(await isGlobalAdmin(ctx, actorId))) {
      throw new NotFoundError("ProjectView", view.id);
    }
  };

  return {
    createProjectView: async (args) => {
      await assertCanWrite(ctx, args.projectId, args.actorId, "view.manage");
      const { actorId: _a, ...fields } = args;
      const view = ProjectView.parse({ id: ctx.genId(), ...fields });
      await db.insertInto("project_views").values(codec.encode(view) as never).execute();
      return view;
    },

    getProjectView: async ({ actorId, viewId }) => {
      const view = await load(viewId);
      await assertCanReadView(view, actorId);
      return view;
    },

    updateProjectView: async (args) => {
      const view = await load(args.viewId);
      await assertCanWrite(ctx, view.projectId, args.actorId, "view.manage");
      const patch: Record<string, unknown> = {};
      for (const f of ["name", "layout", "filter", "groupBy", "sortBy", "sortDirection", "columns", "visibility", "sortOrder"] as const) {
        if ((args as Record<string, unknown>)[f] !== undefined) patch[f] = (args as Record<string, unknown>)[f];
      }
      const merged = ProjectView.parse({ ...view, ...patch });
      await db.updateTable("project_views").set(codec.encode(merged) as never).where("id", "=", merged.id).execute();
      return merged;
    },

    deleteProjectView: async ({ actorId, viewId }) => {
      const view = await load(viewId);
      await assertCanWrite(ctx, view.projectId, actorId, "view.manage");
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom("issue_board_positions").where("view_id", "=", viewId).execute();
        await trx.deleteFrom("project_views").where("id", "=", viewId).execute();
      });
    },

    listProjectViews: async ({ actorId, projectId, visibility, layout, pagination }) => {
      await assertCanReadProject(ctx, projectId, actorId);
      const limit = pagination?.limit ?? 20;
      const cursor = decodeCursor(pagination?.cursor);
      let q = db.selectFrom("project_views").selectAll().where("project_id", "=", projectId);
      if (layout) q = q.where("layout", "=", layout);
      // Accessible to the viewer: shared (public) views plus the actor's own
      // private views. A `visibility` filter narrows within that scope — it can
      // never widen it to another user's private views.
      q = q.where((eb) => eb.or([eb("visibility", "=", "public"), eb("owner_id", "=", actorId)]));
      if (visibility) q = q.where("visibility", "=", visibility);
      if (cursor) q = q.where("id", ">", cursor);
      const rows = await q.orderBy("id").limit(limit + 1).execute();
      const page = buildPage(rows.map((r) => codec.decode(r)), (v) => v.id, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    moveIssueOnBoard: async ({ actorId, viewId, issueId, beforeIssueId, afterIssueId, position }) => {
      const view = await load(viewId);
      await assertCanWrite(ctx, view.projectId, actorId, "view.manage");

      const specifiers = [beforeIssueId, afterIssueId, position].filter((v) => v !== undefined);
      if (specifiers.length !== 1) {
        throw new ConflictError("Provide exactly one of beforeIssueId, afterIssueId, or position");
      }

      const rows = await db.selectFrom("issue_board_positions").select(["issue_id", "position"]).where("view_id", "=", viewId).execute();
      const others = rows.filter((r) => r.issue_id !== issueId).map((r) => r.position).sort((a, b) => a - b);
      const posOf = (id: string): number | undefined => rows.find((r) => r.issue_id === id)?.position;

      let newPos: number;
      if (position !== undefined) {
        newPos = position;
      } else if (afterIssueId !== undefined) {
        const anchor = posOf(afterIssueId) ?? 0;
        const next = others.find((p) => p > anchor);
        newPos = next === undefined ? anchor + 1 : (anchor + next) / 2;
      } else {
        const anchor = posOf(beforeIssueId as string) ?? 0;
        const prev = [...others].reverse().find((p) => p < anchor);
        newPos = prev === undefined ? anchor - 1 : (prev + anchor) / 2;
      }

      const existing = await db.selectFrom("issue_board_positions").selectAll().where("view_id", "=", viewId).where("issue_id", "=", issueId).executeTakeFirst();
      const entry: IssueBoardPositionT = IssueBoardPosition.parse({ id: existing?.id ?? ctx.genId(), viewId, issueId, position: newPos });
      if (existing) {
        await db.updateTable("issue_board_positions").set({ position: newPos }).where("id", "=", existing.id).execute();
      } else {
        await db.insertInto("issue_board_positions").values(posCodec.encode(entry) as never).execute();
      }
      return entry;
    },

    listBoardPositions: async ({ actorId, viewId }) => {
      await assertCanReadView(await load(viewId), actorId);
      const rows = await db.selectFrom("issue_board_positions").selectAll().where("view_id", "=", viewId).orderBy("position").execute();
      return { positions: rows.map((r) => posCodec.decode(r)) };
    },
  };
}
