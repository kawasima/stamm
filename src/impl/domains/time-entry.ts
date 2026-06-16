import { sql } from "kysely";
import { TimeEntry } from "../../schema/index.js";
import type { TimeEntry as TimeEntryT } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { assertCanWrite } from "../permissions.js";
import { buildPage, decodeCursor } from "../pagination.js";

type TimeMethods = "createTimeEntry" | "getTimeEntry" | "updateTimeEntry" | "deleteTimeEntry" | "listTimeEntries" | "getTimeSummary";

export function timeEntryBehaviors(ctx: Ctx): Pick<Behaviors, TimeMethods> {
  const db = ctx.db;
  const codec = makeCodec(TimeEntry);

  const load = async (id: string): Promise<TimeEntryT> => {
    const row = await db.selectFrom("time_entries").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundError("TimeEntry", id);
    return codec.decode(row);
  };

  return {
    createTimeEntry: async (args) => {
      await assertCanWrite(ctx, args.projectId, args.actorId, "time_entry.create");
      const entry = TimeEntry.parse({
        id: ctx.genId(), occurredAt: ctx.now(), projectId: args.projectId, issueId: args.issueId,
        userId: args.userId, activityId: args.activityId, hours: args.hours, spentOn: args.spentOn, comment: args.comment,
      });
      await db.insertInto("time_entries").values(codec.encode(entry) as never).execute();
      return entry;
    },

    getTimeEntry: async ({ timeEntryId }) => load(timeEntryId),

    updateTimeEntry: async (args) => {
      const current = await load(args.timeEntryId);
      await assertCanWrite(ctx, current.projectId, args.actorId, "time_entry.update");
      const patch: Record<string, unknown> = {};
      for (const f of ["activityId", "hours", "spentOn", "comment"] as const) {
        if ((args as Record<string, unknown>)[f] !== undefined) patch[f] = (args as Record<string, unknown>)[f];
      }
      const merged = TimeEntry.parse({ ...current, ...patch });
      await db.updateTable("time_entries").set(codec.encode(merged) as never).where("id", "=", merged.id).execute();
      return merged;
    },

    deleteTimeEntry: async ({ actorId, timeEntryId }) => {
      const current = await load(timeEntryId);
      await assertCanWrite(ctx, current.projectId, actorId, "time_entry.delete");
      await db.deleteFrom("time_entries").where("id", "=", timeEntryId).execute();
    },

    listTimeEntries: async (args) => {
      const limit = args.pagination?.limit ?? 20;
      const dir: "asc" | "desc" = args.sortDirection === "desc" ? "desc" : "asc";
      const cursor = decodeCursor(args.pagination?.cursor);
      let q = db.selectFrom("time_entries").selectAll();
      if (args.projectId) q = q.where("project_id", "=", args.projectId);
      if (args.issueId) q = q.where("issue_id", "=", args.issueId);
      if (args.userId) q = q.where("user_id", "=", args.userId);
      if (args.activityId) q = q.where("activity_id", "=", args.activityId);
      if (args.spentOnFrom) q = q.where("spent_on", ">=", args.spentOnFrom);
      if (args.spentOnTo) q = q.where("spent_on", "<=", args.spentOnTo);

      const numeric = args.sortBy === "hours";
      const col = args.sortBy === "hours" ? "hours" : args.sortBy === "occurredAt" ? "occurred_at" : "spent_on";
      if (cursor) {
        const sep = cursor.indexOf(" ");
        const cv = cursor.slice(0, sep);
        const ci = cursor.slice(sep + 1);
        const v: unknown = numeric ? Number(cv) : cv;
        q = dir === "asc"
          ? q.where(sql<boolean>`(${sql.ref(col)} > ${v}) or (${sql.ref(col)} = ${v} and id > ${ci})`)
          : q.where(sql<boolean>`(${sql.ref(col)} < ${v}) or (${sql.ref(col)} = ${v} and id < ${ci})`);
      }
      const rows = await q.orderBy(col as never, dir).orderBy("id", dir).limit(limit + 1).execute();
      const keyOf = (e: TimeEntryT) => `${args.sortBy === "hours" ? e.hours : args.sortBy === "occurredAt" ? e.occurredAt : e.spentOn} ${e.id}`;
      const page = buildPage(rows.map((r) => codec.decode(r)), keyOf, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    getTimeSummary: async (args) => {
      let q = db.selectFrom("time_entries");
      if (args.projectId) q = q.where("project_id", "=", args.projectId);
      if (args.issueId) q = q.where("issue_id", "=", args.issueId);
      if (args.userId) q = q.where("user_id", "=", args.userId);
      if (args.spentOnFrom) q = q.where("spent_on", ">=", args.spentOnFrom);
      if (args.spentOnTo) q = q.where("spent_on", "<=", args.spentOnTo);

      const col = (
        { user: "user_id", activity: "activity_id", issue: "issue_id", project: "project_id", date: "spent_on" } as const
      )[args.groupBy];
      if (args.groupBy === "issue") q = q.where("issue_id", "is not", null);
      const rows = await q
        .select([sql.ref(col).as("key"), sql<number>`sum(hours)`.as("hours")])
        .groupBy(sql.ref(col))
        .execute();

      const groups = rows.map((r) => ({ key: String((r as { key: unknown }).key ?? ""), label: String((r as { key: unknown }).key ?? ""), hours: Number((r as { hours: unknown }).hours) }));

      // resolve human labels where cheap
      if (args.groupBy === "user" || args.groupBy === "issue" || args.groupBy === "project") {
        const ids = groups.map((g) => g.key).filter((k) => k.length > 0);
        if (ids.length) {
          if (args.groupBy === "user") {
            const us = await db.selectFrom("users").select(["id", "display_name"]).where("id", "in", ids).execute();
            const m = new Map(us.map((u) => [u.id, u.display_name]));
            for (const g of groups) g.label = m.get(g.key) ?? g.key;
          } else if (args.groupBy === "project") {
            const ps = await db.selectFrom("projects").select(["id", "name"]).where("id", "in", ids).execute();
            const m = new Map(ps.map((p) => [p.id, p.name]));
            for (const g of groups) g.label = m.get(g.key) ?? g.key;
          } else {
            const is = await db.selectFrom("issues").select(["id", "key", "number"]).where("id", "in", ids).execute();
            const m = new Map(is.map((i) => [i.id, `${i.key}-${i.number}`]));
            for (const g of groups) g.label = m.get(g.key) ?? g.key;
          }
        }
      }
      const totalHours = groups.reduce((s, g) => s + g.hours, 0);
      return { totalHours, groups };
    },
  };
}
