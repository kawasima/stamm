import { sql } from "kysely";
import { Iteration } from "../../schema/index.js";
import type { Iteration as IterationT } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { assertCanWrite, assertCanReadProject } from "../permissions.js";
import { asMissing, issueVisible } from "../issue-visibility.js";
import { listPage, nullsLast, text } from "../listing.js";

type IterationMethods =
  | "createIteration" | "getIteration" | "updateIteration" | "deleteIteration" | "listIterations" | "getIterationProgress";

export function iterationBehaviors(ctx: Ctx): Pick<Behaviors, IterationMethods> {
  const db = ctx.db;
  const codec = makeCodec(Iteration);

  const load = async (id: string): Promise<IterationT> => {
    const row = await db.selectFrom("iterations").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundError("Iteration", id);
    return codec.decode(row);
  };

  return {
    createIteration: async (args) => {
      await assertCanWrite(ctx, args.projectId, args.actorId, "iteration.manage");
      const it = Iteration.parse({ id: ctx.genId(), projectId: args.projectId, name: args.name, startDate: args.startDate, endDate: args.endDate, sortOrder: args.sortOrder });
      await db.insertInto("iterations").values(codec.encode(it) as never).execute();
      return it;
    },

    getIteration: async ({ actorId, iterationId }) => {
      const it = await load(iterationId);
      await asMissing("Iteration", it.id, () => assertCanReadProject(ctx, it.projectId, actorId));
      return it;
    },

    updateIteration: async (args) => {
      const it = await load(args.iterationId);
      await asMissing("Iteration", it.id, () => assertCanWrite(ctx, it.projectId, args.actorId, "iteration.manage"));
      const patch: Record<string, unknown> = {};
      for (const f of ["name", "startDate", "endDate", "sortOrder"] as const) {
        if ((args as Record<string, unknown>)[f] !== undefined) patch[f] = (args as Record<string, unknown>)[f];
      }
      const merged = Iteration.parse({ ...it, ...patch });
      await db.updateTable("iterations").set(codec.encode(merged) as never).where("id", "=", merged.id).execute();
      return merged;
    },

    deleteIteration: async ({ actorId, iterationId }) => {
      const it = await load(iterationId);
      await asMissing("Iteration", it.id, () => assertCanWrite(ctx, it.projectId, actorId, "iteration.manage"));
      await db.deleteFrom("iterations").where("id", "=", iterationId).execute();
    },

    listIterations: async ({ actorId, projectId, sortBy, sortDirection, pagination }) => {
      await assertCanReadProject(ctx, projectId, actorId);
      const dir = sortDirection ?? "asc";
      const by = sortBy ?? "sortOrder";
      const keys = { name: [text("name", dir)], startDate: nullsLast(sql.ref("start_date"), dir), sortOrder: [{ by: sql.ref("sort_order"), dir }] }[by];
      const page = await listPage(db.selectFrom("iterations").selectAll().where("project_id", "=", projectId), { name: `iterations ${by}`, keys }, "id", pagination);
      return { items: page.items.map((r) => codec.decode(r)), nextCursor: page.nextCursor };
    },

    getIterationProgress: async ({ actorId, iterationId }) => {
      const it = await load(iterationId);
      await asMissing("Iteration", it.id, () => assertCanReadProject(ctx, it.projectId, actorId));
      const rows = await db
        .selectFrom("issue_iterations as ii")
        .innerJoin("issues as i", "i.id", "ii.issue_id")
        .innerJoin("statuses as s", "s.id", "i.status_id")
        .where(await issueVisible(ctx, actorId, "i"))
        .select(["s.category as category", (eb) => eb.fn.countAll().as("cnt")])
        .where("ii.iteration_id", "=", iterationId)
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
      return { iterationId, totalIssues: total, openIssues: total - closed, closedIssues: closed, completionPercentage };
    },
  };
}
