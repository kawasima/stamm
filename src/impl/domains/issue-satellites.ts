import {
  IssueAssignee,
  IssueLabel,
  IssueCategory,
  IssueMilestone,
  IssueParent,
  IssueSchedule,
  IssueEstimation,
  IssueProgress,
  IssueIteration,
  IssueWatcher,
  IssueRelation,
} from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { appendActivity } from "../timeline.js";
import { recordScheduleChange, recordEstimationChange } from "../issue-events.js";
import { notifyIssueEvent } from "../notifications.js";
import { assertCanWrite, assertCanReadIssue } from "../permissions.js";
import { buildPage, decodeCursor } from "../pagination.js";

type SatelliteMethods =
  | "setIssueAssignees" | "setIssueLabels" | "setIssueCategory" | "setIssueMilestone"
  | "setIssueParent" | "setIssueSchedule" | "setIssueEstimation" | "setIssueProgress" | "setIssueIteration"
  | "watchIssue" | "unwatchIssue" | "listIssueWatchers"
  | "createIssueRelation" | "deleteIssueRelation" | "listIssueRelations";

export function issueSatelliteBehaviors(ctx: Ctx): Pick<Behaviors, SatelliteMethods> {
  const db = ctx.db;
  const adb = db as unknown as import("kysely").Kysely<any>;
  const assigneeCodec = makeCodec(IssueAssignee);
  const labelCodec = makeCodec(IssueLabel);
  const categoryCodec = makeCodec(IssueCategory);
  const milestoneCodec = makeCodec(IssueMilestone);
  const parentCodec = makeCodec(IssueParent);
  const scheduleCodec = makeCodec(IssueSchedule);
  const estimationCodec = makeCodec(IssueEstimation);
  const progressCodec = makeCodec(IssueProgress);
  const iterationCodec = makeCodec(IssueIteration);
  const watcherCodec = makeCodec(IssueWatcher);
  const relationCodec = makeCodec(IssueRelation);

  const issueProjectId = async (issueId: string): Promise<string> => {
    const row = await db.selectFrom("issues").select("project_id").where("id", "=", issueId).executeTakeFirst();
    if (!row) throw new NotFoundError("Issue", issueId);
    return row.project_id;
  };

  /** Replace the single 0..1 satellite row for an issue and return the new value. */
  const upsertOne = async <T>(
    table: string,
    codec: { encode: (v: T) => Record<string, unknown> },
    issueId: string,
    value: T,
  ): Promise<T> => {
    await adb.transaction().execute(async (trx: any) => {
      await trx.deleteFrom(table).where("issue_id", "=", issueId).execute();
      await trx.insertInto(table).values(codec.encode(value)).execute();
    });
    return value;
  };

  return {
    setIssueAssignees: async ({ actorId, issueId, assigneeIds }) => {
      const projectId = await issueProjectId(issueId);
      await assertCanWrite(ctx, projectId, actorId, "issue.assign");
      const assignees = assigneeIds.map((assigneeId) => IssueAssignee.parse({ id: ctx.genId(), issueId, assigneeId }));
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom("issue_assignees").where("issue_id", "=", issueId).execute();
        for (const a of assignees) await trx.insertInto("issue_assignees").values(assigneeCodec.encode(a) as never).execute();
        await appendActivity(ctx, trx, { projectId, userId: actorId, action: "assigned", targetType: "issue", targetId: issueId });
        await notifyIssueEvent(ctx, trx as never, { projectId, issueId, authorId: actorId, eventType: "issue.assigned", title: "You were assigned", actorId, onlyRecipients: assigneeIds });
      });
      return { assignees };
    },

    setIssueLabels: async ({ actorId, issueId, labelIds }) => {
      const projectId = await issueProjectId(issueId);
      await assertCanWrite(ctx, projectId, actorId, "issue.update");
      const labels = labelIds.map((labelId) => IssueLabel.parse({ id: ctx.genId(), issueId, labelId }));
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom("issue_labels").where("issue_id", "=", issueId).execute();
        for (const l of labels) await trx.insertInto("issue_labels").values(labelCodec.encode(l) as never).execute();
        await appendActivity(ctx, trx, { projectId, userId: actorId, action: "labeled", targetType: "issue", targetId: issueId });
      });
      return { labels };
    },

    setIssueCategory: async ({ actorId, issueId, categoryId }) => {
      const projectId = await issueProjectId(issueId);
      await assertCanWrite(ctx, projectId, actorId, "issue.update");
      return upsertOne("issue_categories", categoryCodec, issueId, IssueCategory.parse({ id: ctx.genId(), issueId, categoryId }));
    },

    setIssueMilestone: async ({ actorId, issueId, milestoneId }) => {
      const projectId = await issueProjectId(issueId);
      await assertCanWrite(ctx, projectId, actorId, "issue.update");
      return upsertOne("issue_milestones", milestoneCodec, issueId, IssueMilestone.parse({ id: ctx.genId(), issueId, milestoneId }));
    },

    setIssueParent: async ({ actorId, childIssueId, parentIssueId }) => {
      const projectId = await issueProjectId(childIssueId);
      await assertCanWrite(ctx, projectId, actorId, "issue.update");
      const value = IssueParent.parse({ id: ctx.genId(), childIssueId, parentIssueId });
      await adb.transaction().execute(async (trx: any) => {
        await trx.deleteFrom("issue_parents").where("child_issue_id", "=", childIssueId).execute();
        await trx.insertInto("issue_parents").values(parentCodec.encode(value)).execute();
      });
      return value;
    },

    setIssueSchedule: async ({ actorId, issueId, startDate, dueDate }) => {
      const projectId = await issueProjectId(issueId);
      await assertCanWrite(ctx, projectId, actorId, "issue.update");
      const value = IssueSchedule.parse({ id: ctx.genId(), issueId, startDate, dueDate });
      await db.transaction().execute(async (trx) => {
        const old = await trx.selectFrom("issue_schedules").select(["start_date", "due_date"]).where("issue_id", "=", issueId).executeTakeFirst();
        await trx.deleteFrom("issue_schedules").where("issue_id", "=", issueId).execute();
        await trx.insertInto("issue_schedules").values(scheduleCodec.encode(value) as never).execute();
        await recordScheduleChange(ctx, trx, { issueId, projectId, userId: actorId, from: { startDate: old?.start_date, dueDate: old?.due_date }, to: { startDate, dueDate } });
      });
      return value;
    },

    setIssueEstimation: async ({ actorId, issueId, estimatedHours }) => {
      const projectId = await issueProjectId(issueId);
      await assertCanWrite(ctx, projectId, actorId, "issue.update");
      const value = IssueEstimation.parse({ id: ctx.genId(), issueId, estimatedHours });
      await db.transaction().execute(async (trx) => {
        const old = await trx.selectFrom("issue_estimations").select("estimated_hours").where("issue_id", "=", issueId).executeTakeFirst();
        await trx.deleteFrom("issue_estimations").where("issue_id", "=", issueId).execute();
        await trx.insertInto("issue_estimations").values(estimationCodec.encode(value) as never).execute();
        await recordEstimationChange(ctx, trx, { issueId, projectId, userId: actorId, fromHours: old?.estimated_hours ?? null, toHours: estimatedHours });
      });
      return value;
    },

    setIssueProgress: async ({ actorId, issueId, doneRatio }) => {
      const projectId = await issueProjectId(issueId);
      await assertCanWrite(ctx, projectId, actorId, "issue.update");
      return upsertOne("issue_progress", progressCodec, issueId, IssueProgress.parse({ id: ctx.genId(), issueId, doneRatio }));
    },

    setIssueIteration: async ({ actorId, issueId, iterationId }) => {
      const projectId = await issueProjectId(issueId);
      await assertCanWrite(ctx, projectId, actorId, "issue.update");
      return upsertOne("issue_iterations", iterationCodec, issueId, IssueIteration.parse({ id: ctx.genId(), issueId, iterationId }));
    },

    watchIssue: async ({ actorId, issueId }) => {
      await issueProjectId(issueId); // existence
      const existing = await db.selectFrom("issue_watchers").selectAll().where("issue_id", "=", issueId).where("user_id", "=", actorId).executeTakeFirst();
      if (existing) return watcherCodec.decode(existing);
      const w = IssueWatcher.parse({ id: ctx.genId(), issueId, userId: actorId });
      await db.insertInto("issue_watchers").values(watcherCodec.encode(w) as never).execute();
      return w;
    },

    unwatchIssue: async ({ actorId, issueId }) => {
      await db.deleteFrom("issue_watchers").where("issue_id", "=", issueId).where("user_id", "=", actorId).execute();
    },

    listIssueWatchers: async ({ actorId, issueId }) => {
      await assertCanReadIssue(ctx, issueId, actorId);
      const rows = await db.selectFrom("issue_watchers").selectAll().where("issue_id", "=", issueId).orderBy("id").execute();
      return { watchers: rows.map((r) => watcherCodec.decode(r)) };
    },

    createIssueRelation: async ({ actorId, issueId, relatedIssueId, relationType, delay }) => {
      const projectId = await issueProjectId(issueId);
      await assertCanWrite(ctx, projectId, actorId, "issue.update");
      const relation = IssueRelation.parse({ id: ctx.genId(), issueId, relatedIssueId, relationType, delay });
      await db.insertInto("issue_relations").values(relationCodec.encode(relation) as never).execute();
      return relation;
    },

    deleteIssueRelation: async ({ actorId, relationId }) => {
      const row = await db.selectFrom("issue_relations").select("issue_id").where("id", "=", relationId).executeTakeFirst();
      if (!row) throw new NotFoundError("IssueRelation", relationId);
      await assertCanWrite(ctx, await issueProjectId(row.issue_id), actorId, "issue.update");
      await db.deleteFrom("issue_relations").where("id", "=", relationId).execute();
    },

    listIssueRelations: async ({ actorId, issueId, relationType, pagination }) => {
      await assertCanReadIssue(ctx, issueId, actorId);
      const limit = pagination?.limit ?? 20;
      const cursor = decodeCursor(pagination?.cursor);
      let q = db.selectFrom("issue_relations").selectAll().where("issue_id", "=", issueId);
      if (relationType) q = q.where("relation_type", "=", relationType);
      if (cursor) q = q.where("id", ">", cursor);
      const rows = await q.orderBy("id").limit(limit + 1).execute();
      const page = buildPage(rows.map((r) => relationCodec.decode(r)), (r) => r.id, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },
  };
}
