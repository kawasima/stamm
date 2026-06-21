import { Milestone } from "../../schema/index.js";
import type { Milestone as MilestoneT } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { assertCanWrite, assertCanReadProject } from "../permissions.js";
import { buildPage, decodeCursor } from "../pagination.js";

type MilestoneMethods =
  | "createMilestone" | "getMilestone" | "updateMilestone" | "deleteMilestone" | "listMilestones"
  | "closeMilestone" | "reopenMilestone" | "lockMilestone" | "getMilestoneProgress";

export function milestoneBehaviors(ctx: Ctx): Pick<Behaviors, MilestoneMethods> {
  const db = ctx.db;
  const codec = makeCodec(Milestone);

  const load = async (id: string): Promise<MilestoneT> => {
    const row = await db.selectFrom("milestones").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundError("Milestone", id);
    return codec.decode(row);
  };
  const save = async (m: MilestoneT): Promise<MilestoneT> => {
    await db.updateTable("milestones").set(codec.encode(m) as never).where("id", "=", m.id).execute();
    return m;
  };

  return {
    createMilestone: async (args) => {
      await assertCanWrite(ctx, args.projectId, args.actorId, "milestone.manage");
      const m = Milestone.parse({
        id: ctx.genId(), projectId: args.projectId, name: args.name, description: args.description,
        status: "open", startDate: args.startDate, dueDate: args.dueDate, sortOrder: args.sortOrder,
      });
      await db.insertInto("milestones").values(codec.encode(m) as never).execute();
      return m;
    },

    getMilestone: async ({ actorId, milestoneId }) => {
      const m = await load(milestoneId);
      await assertCanReadProject(ctx, m.projectId, actorId);
      return m;
    },

    updateMilestone: async (args) => {
      const m = await load(args.milestoneId);
      await assertCanWrite(ctx, m.projectId, args.actorId, "milestone.manage");
      const patch: Record<string, unknown> = {};
      for (const f of ["name", "description", "startDate", "dueDate", "releaseDate", "sortOrder"] as const) {
        if ((args as Record<string, unknown>)[f] !== undefined) patch[f] = (args as Record<string, unknown>)[f];
      }
      return save(Milestone.parse({ ...m, ...patch }));
    },

    deleteMilestone: async ({ actorId, milestoneId }) => {
      const m = await load(milestoneId);
      await assertCanWrite(ctx, m.projectId, actorId, "milestone.manage");
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom("issue_milestones").where("milestone_id", "=", milestoneId).execute();
        await trx.deleteFrom("milestones").where("id", "=", milestoneId).execute();
      });
    },

    listMilestones: async ({ actorId, projectId, status, pagination }) => {
      await assertCanReadProject(ctx, projectId, actorId);
      const limit = pagination?.limit ?? 20;
      const cursor = decodeCursor(pagination?.cursor);
      let q = db.selectFrom("milestones").selectAll().where("project_id", "=", projectId);
      if (status) q = q.where("status", "=", status);
      if (cursor) q = q.where("id", ">", cursor);
      const rows = await q.orderBy("id").limit(limit + 1).execute();
      const page = buildPage(rows.map((r) => codec.decode(r)), (m) => m.id, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    closeMilestone: async ({ actorId, milestoneId, releaseDate }) => {
      const m = await load(milestoneId);
      await assertCanWrite(ctx, m.projectId, actorId, "milestone.manage");
      return save(Milestone.parse({ ...m, status: "closed", ...(releaseDate !== undefined ? { releaseDate } : {}) }));
    },

    reopenMilestone: async ({ actorId, milestoneId }) => {
      const m = await load(milestoneId);
      await assertCanWrite(ctx, m.projectId, actorId, "milestone.manage");
      return save(Milestone.parse({ ...m, status: "open" }));
    },

    lockMilestone: async ({ actorId, milestoneId }) => {
      const m = await load(milestoneId);
      await assertCanWrite(ctx, m.projectId, actorId, "milestone.manage");
      return save(Milestone.parse({ ...m, status: "locked" }));
    },

    getMilestoneProgress: async ({ actorId, milestoneId }) => {
      const m = await load(milestoneId); // existence
      await assertCanReadProject(ctx, m.projectId, actorId);
      const rows = await db
        .selectFrom("issue_milestones as im")
        .innerJoin("issues as i", "i.id", "im.issue_id")
        .innerJoin("statuses as s", "s.id", "i.status_id")
        .select(["s.category as category", (eb) => eb.fn.countAll().as("cnt")])
        .where("im.milestone_id", "=", milestoneId)
        .groupBy("s.category")
        .execute();
      let total = 0;
      let closed = 0;
      for (const r of rows) {
        const cnt = Number(r.cnt);
        total += cnt;
        if (r.category === "done") closed += cnt;
      }
      const completionPercentage = total === 0 ? 0 : Math.round((closed / total) * 100);
      return { milestoneId, totalIssues: total, openIssues: total - closed, closedIssues: closed, completionPercentage };
    },
  };
}
