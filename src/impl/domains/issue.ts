import {
  Issue,
  IssueDetail,
  IssueSchedule,
  IssueEstimation,
  IssueProgress,
  IssueRelation,
  User,
  Label,
  Category,
  Milestone,
  Iteration,
} from "../../schema/index.js";
import { IssueStatusChange, IssueScheduleChange, IssueEstimationChange } from "../../schema/index.js";
import type { Issue as IssueT } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { sql } from "kysely";
import { makeCodec } from "../db/codec.js";
import { appendActivity } from "../timeline.js";
import { recordScheduleChange, recordEstimationChange } from "../issue-events.js";
import { notifyIssueEvent } from "../notifications.js";
import { assertCanWrite, isGlobalAdmin, isMember, roleIdsOf, rolesOf } from "../permissions.js";
import { buildPage, decodeCursor } from "../pagination.js";
import { assertTransitionAllowed, availableTransitions, resolveDefaultStatus, transitionsForScope } from "../workflow.js";
import { validateCustomFields } from "./custom-field.js";

type IssueMethods =
  | "createIssue" | "getIssue" | "getIssueByKey" | "getIssueDetail"
  | "updateIssue" | "deleteIssue" | "moveIssue"
  | "transitionIssueStatus" | "getAvailableTransitions" | "listIssueStatusHistory"
  | "listIssueScheduleHistory" | "listIssueEstimationHistory"
  | "listIssues" | "listChildIssues";

export function issueBehaviors(ctx: Ctx): Pick<Behaviors, IssueMethods> {
  const db = ctx.db;
  const issueCodec = makeCodec(Issue, { json: ["customFields"] });
  const scheduleCodec = makeCodec(IssueSchedule);
  const estimationCodec = makeCodec(IssueEstimation);
  const progressCodec = makeCodec(IssueProgress);
  const relationCodec = makeCodec(IssueRelation);
  const statusChangeCodec = makeCodec(IssueStatusChange);
  const scheduleChangeCodec = makeCodec(IssueScheduleChange);
  const estimationChangeCodec = makeCodec(IssueEstimationChange);
  // Codecs for the resources a detail view hydrates its satellites into.
  const userCodec = makeCodec(User);
  const labelResCodec = makeCodec(Label);
  const categoryResCodec = makeCodec(Category);
  const milestoneResCodec = makeCodec(Milestone);
  const iterationResCodec = makeCodec(Iteration);

  const loadIssue = async (issueId: string): Promise<IssueT> => {
    const row = await db.selectFrom("issues").selectAll().where("id", "=", issueId).executeTakeFirst();
    if (!row) throw new NotFoundError("Issue", issueId);
    return issueCodec.decode(row);
  };

  const isAssignee = async (issueId: string, userId: string): Promise<boolean> => {
    const row = await db
      .selectFrom("issue_assignees")
      .select("id")
      .where("issue_id", "=", issueId)
      .where("assignee_id", "=", userId)
      .executeTakeFirst();
    return row !== undefined;
  };

  /**
   * Read scoping: global admins see all. Otherwise a private project or a
   * private issue is hidden from non-members (author always sees their own). A
   * member whose roles are all `own_or_assigned` only sees issues they authored
   * or are assigned to.
   */
  const canSeeIssue = async (actorId: string, issue: IssueT): Promise<boolean> => {
    if (await isGlobalAdmin(ctx, actorId)) return true;
    const author = issue.authorId === actorId;
    const member = await isMember(ctx, issue.projectId, actorId);
    const cat = await db
      .selectFrom("project_categories")
      .select("visibility")
      .where("project_id", "=", issue.projectId)
      .executeTakeFirst();
    if (cat?.visibility === "private" && !member && !author) return false;
    if (issue.visibility === "private" && !member && !author) return false;
    if (member) {
      const roles = await rolesOf(ctx, issue.projectId, actorId);
      const restricted = roles.length > 0 && roles.every((r) => r.issuesVisibility === "own_or_assigned");
      if (restricted && !author) return isAssignee(issue.id, actorId);
    }
    return true;
  };

  const seenOrNotFound = async (actorId: string, issue: IssueT): Promise<IssueT> => {
    if (!(await canSeeIssue(actorId, issue))) throw new NotFoundError("Issue", issue.id);
    return issue;
  };

  // dynamic satellite tables/columns; the Zod codecs re-establish typing
  const adb = db as unknown as import("kysely").Kysely<any>;
  const satMany = async <T>(table: string, codec: { decode: (r: Record<string, unknown>) => T }, issueId: string): Promise<T[]> => {
    const rows = await adb.selectFrom(table).selectAll().where("issue_id", "=", issueId).execute();
    return rows.map((r: Record<string, unknown>) => codec.decode(r));
  };
  const satOne = async <T>(table: string, codec: { decode: (r: Record<string, unknown>) => T }, issueId: string, idCol = "issue_id"): Promise<T | undefined> => {
    const row = await adb.selectFrom(table).selectAll().where(idCol, "=", issueId).executeTakeFirst();
    return row ? codec.decode(row as Record<string, unknown>) : undefined;
  };

  // Hydrate a satellite into its target resource: join the junction table to the
  // target on the junction's FK, select only the target's columns, and decode
  // into the target resource. A junction pointing at a since-deleted target
  // simply drops out (inner join), so the detail omits it rather than erroring.
  const hydrateMany = async <T>(
    junction: string, target: string, fk: string,
    codec: { decode: (r: Record<string, unknown>) => T }, issueId: string,
  ): Promise<T[]> => {
    const rows = await adb.selectFrom(junction)
      .innerJoin(target, `${target}.id`, `${junction}.${fk}`)
      .where(`${junction}.issue_id`, "=", issueId)
      .selectAll(target)
      .execute();
    return rows.map((r: Record<string, unknown>) => codec.decode(r));
  };
  const hydrateOne = async <T>(
    junction: string, target: string, fk: string,
    codec: { decode: (r: Record<string, unknown>) => T }, issueId: string, issueCol = "issue_id",
  ): Promise<T | undefined> => {
    const row = await adb.selectFrom(junction)
      .innerJoin(target, `${target}.id`, `${junction}.${fk}`)
      .where(`${junction}.${issueCol}`, "=", issueId)
      .selectAll(target)
      .executeTakeFirst();
    return row ? codec.decode(row as Record<string, unknown>) : undefined;
  };

  return {
    createIssue: async (args) => {
      await assertCanWrite(ctx, args.projectId, args.actorId, "issue.create");
      const proj = await db.selectFrom("projects").select("identifier").where("id", "=", args.projectId).executeTakeFirst();
      if (!proj) throw new NotFoundError("Project", args.projectId);
      await validateCustomFields(ctx, { projectId: args.projectId, issueTypeId: args.issueTypeId, values: args.customFields });
      const statusId = args.statusId ?? (await resolveDefaultStatus(ctx, args.projectId, args.issueTypeId)).id;

      let issue!: IssueT;
      await db.transaction().execute(async (trx) => {
        const maxRow = await trx
          .selectFrom("issues")
          .select((eb) => eb.fn.max("number").as("m"))
          .where("project_id", "=", args.projectId)
          .executeTakeFirst();
        const number = Number(maxRow?.m ?? 0) + 1;
        issue = Issue.parse({
          id: ctx.genId(),
          key: proj.identifier,
          number,
          projectId: args.projectId,
          issueTypeId: args.issueTypeId,
          priorityId: args.priorityId,
          statusId,
          subject: args.subject,
          description: args.description,
          authorId: args.actorId,
          visibility: args.visibility ?? "public",
          customFields: args.customFields ?? [],
        });
        const iid = issue.id;
        await trx.insertInto("issues").values(issueCodec.encode(issue) as never).execute();
        for (const assigneeId of args.assigneeIds ?? []) {
          await trx.insertInto("issue_assignees").values({ id: ctx.genId(), issue_id: iid, assignee_id: assigneeId }).execute();
        }
        for (const labelId of args.labelIds ?? []) {
          await trx.insertInto("issue_labels").values({ id: ctx.genId(), issue_id: iid, label_id: labelId }).execute();
        }
        if (args.categoryId) await trx.insertInto("issue_categories").values({ id: ctx.genId(), issue_id: iid, category_id: args.categoryId }).execute();
        if (args.milestoneId) await trx.insertInto("issue_milestones").values({ id: ctx.genId(), issue_id: iid, milestone_id: args.milestoneId }).execute();
        if (args.parentIssueId) await trx.insertInto("issue_parents").values({ id: ctx.genId(), child_issue_id: iid, parent_issue_id: args.parentIssueId }).execute();
        if (args.startDate !== undefined || args.dueDate !== undefined) {
          await trx.insertInto("issue_schedules").values({ id: ctx.genId(), issue_id: iid, start_date: args.startDate ?? null, due_date: args.dueDate ?? null }).execute();
          await recordScheduleChange(ctx, trx, { issueId: iid, projectId: args.projectId, userId: args.actorId, from: {}, to: { startDate: args.startDate, dueDate: args.dueDate } });
        }
        if (args.estimatedHours !== undefined) {
          await trx.insertInto("issue_estimations").values({ id: ctx.genId(), issue_id: iid, estimated_hours: args.estimatedHours }).execute();
          await recordEstimationChange(ctx, trx, { issueId: iid, projectId: args.projectId, userId: args.actorId, fromHours: null, toHours: args.estimatedHours });
        }
        await appendActivity(ctx, trx, { projectId: args.projectId, userId: args.actorId, action: "created", targetType: "issue", targetId: iid });
        await notifyIssueEvent(ctx, trx, { projectId: args.projectId, issueId: iid, authorId: args.actorId, eventType: "issue.created", title: `${issue.key}-${issue.number}: ${issue.subject}`, actorId: args.actorId });
      });
      return issue;
    },

    getIssue: async ({ actorId, issueId }) => seenOrNotFound(actorId, await loadIssue(issueId)),

    getIssueByKey: async ({ actorId, key }) => {
      const dash = key.lastIndexOf("-");
      const identifier = dash >= 0 ? key.slice(0, dash) : key;
      const number = dash >= 0 ? Number(key.slice(dash + 1)) : NaN;
      const row = await db
        .selectFrom("issues")
        .selectAll()
        .where("key", "=", identifier)
        .where("number", "=", number)
        .executeTakeFirst();
      if (!row) throw new NotFoundError("Issue", key);
      return seenOrNotFound(actorId, issueCodec.decode(row));
    },

    getIssueDetail: async ({ actorId, issueId }) => {
      const issue = await seenOrNotFound(actorId, await loadIssue(issueId));
      const [assignees, labels, watchers, relations, category, milestone, iteration, parent, schedule, estimation, progress] =
        await Promise.all([
          hydrateMany("issue_assignees", "users", "assignee_id", userCodec, issueId),
          hydrateMany("issue_labels", "labels", "label_id", labelResCodec, issueId),
          hydrateMany("issue_watchers", "users", "user_id", userCodec, issueId),
          satMany("issue_relations", relationCodec, issueId),
          hydrateOne("issue_categories", "categories", "category_id", categoryResCodec, issueId),
          hydrateOne("issue_milestones", "milestones", "milestone_id", milestoneResCodec, issueId),
          hydrateOne("issue_iterations", "iterations", "iteration_id", iterationResCodec, issueId),
          hydrateOne("issue_parents", "issues", "parent_issue_id", issueCodec, issueId, "child_issue_id"),
          satOne("issue_schedules", scheduleCodec, issueId),
          satOne("issue_estimations", estimationCodec, issueId),
          satOne("issue_progress", progressCodec, issueId),
        ]);
      return IssueDetail.parse({ ...issue, assignees, labels, watchers, relations, category, milestone, iteration, parent, schedule, estimation, progress });
    },

    updateIssue: async (args) => {
      const issue = await loadIssue(args.issueId);
      await assertCanWrite(ctx, issue.projectId, args.actorId, "issue.update");
      if (args.customFields !== undefined) {
        await validateCustomFields(ctx, {
          projectId: issue.projectId,
          issueTypeId: args.issueTypeId ?? issue.issueTypeId,
          values: args.customFields,
        });
      }
      const patch: Partial<IssueT> = {};
      for (const f of ["issueTypeId", "priorityId", "subject", "description", "visibility", "customFields"] as const) {
        if (args[f] !== undefined) (patch as Record<string, unknown>)[f] = args[f];
      }
      const merged = Issue.parse({ ...issue, ...patch });
      await db.transaction().execute(async (trx) => {
        await trx.updateTable("issues").set(issueCodec.encode(merged) as never).where("id", "=", merged.id).execute();
        await appendActivity(ctx, trx, { projectId: merged.projectId, userId: args.actorId, action: "updated", targetType: "issue", targetId: merged.id });
      });
      return merged;
    },

    deleteIssue: async ({ actorId, issueId }) => {
      const issue = await loadIssue(issueId);
      await assertCanWrite(ctx, issue.projectId, actorId, "issue.delete");
      await db.transaction().execute(async (trx) => {
        // Delete the Resource (the issue) and its current-state satellites. The
        // Events stay: issue_status_changes / issue_schedule_changes /
        // issue_estimation_changes / activity_entries are append-only and may
        // still be referenced (e.g. by flow metrics), so they survive — the
        // deletion itself is recorded as a `deleted` activity. (See the
        // immutable data model: Resources are deletable, Events are not.)
        for (const t of [
          "issue_assignees", "issue_labels", "issue_watchers", "issue_categories", "issue_milestones",
          "issue_schedules", "issue_estimations", "issue_progress", "issue_iterations",
        ] as const) {
          await trx.deleteFrom(t).where("issue_id", "=", issueId).execute();
        }
        await trx.deleteFrom("issue_parents").where("child_issue_id", "=", issueId).execute();
        await trx.deleteFrom("issue_parents").where("parent_issue_id", "=", issueId).execute();
        await trx.deleteFrom("issue_relations").where("issue_id", "=", issueId).execute();
        await trx.deleteFrom("issue_relations").where("related_issue_id", "=", issueId).execute();
        await appendActivity(ctx, trx, { projectId: issue.projectId, userId: actorId, action: "deleted", targetType: "issue", targetId: issueId });
        await trx.deleteFrom("issues").where("id", "=", issueId).execute();
      });
    },

    moveIssue: async ({ actorId, issueId, targetProjectId, newIssueTypeId }) => {
      const issue = await loadIssue(issueId);
      await assertCanWrite(ctx, issue.projectId, actorId, "issue.move");
      const targetProj = await db.selectFrom("projects").select("identifier").where("id", "=", targetProjectId).executeTakeFirst();
      if (!targetProj) throw new NotFoundError("Project", targetProjectId);
      let moved!: IssueT;
      await db.transaction().execute(async (trx) => {
        const maxRow = await trx
          .selectFrom("issues")
          .select((eb) => eb.fn.max("number").as("m"))
          .where("project_id", "=", targetProjectId)
          .executeTakeFirst();
        const number = Number(maxRow?.m ?? 0) + 1;
        moved = Issue.parse({
          ...issue,
          projectId: targetProjectId,
          key: targetProj.identifier,
          number,
          issueTypeId: newIssueTypeId ?? issue.issueTypeId,
        });
        await trx.updateTable("issues").set(issueCodec.encode(moved) as never).where("id", "=", issueId).execute();
        await appendActivity(ctx, trx, { projectId: targetProjectId, userId: actorId, action: "updated", targetType: "issue", targetId: issueId });
      });
      return moved;
    },

    transitionIssueStatus: async ({ actorId, issueId, toStatusId }) => {
      const issue = await loadIssue(issueId);
      const fromStatusId = issue.statusId;
      if (!(await isGlobalAdmin(ctx, actorId))) {
        const roleIds = await roleIdsOf(ctx, issue.projectId, actorId);
        await assertTransitionAllowed(ctx, { projectId: issue.projectId, issueTypeId: issue.issueTypeId, fromStatusId }, toStatusId, roleIds);
      }
      const toCategory = (await db.selectFrom("statuses").select("category").where("id", "=", toStatusId).executeTakeFirst())?.category;
      const occurredAt = ctx.now();
      await db.transaction().execute(async (trx) => {
        await trx.updateTable("issues").set({ status_id: toStatusId }).where("id", "=", issueId).execute();
        await trx
          .insertInto("issue_status_changes")
          .values({ id: ctx.genId(), issue_id: issueId, from_status_id: fromStatusId, to_status_id: toStatusId, user_id: actorId, occurred_at: occurredAt })
          .execute();
        await appendActivity(ctx, trx, { projectId: issue.projectId, userId: actorId, action: "status_changed", targetType: "issue", targetId: issueId, occurredAt });
        await notifyIssueEvent(ctx, trx, { projectId: issue.projectId, issueId, authorId: issue.authorId, eventType: "issue.status_changed", title: `Status changed: ${issue.key}-${issue.number}`, actorId, occurredAt });
        if (toCategory === "done") {
          await notifyIssueEvent(ctx, trx, { projectId: issue.projectId, issueId, authorId: issue.authorId, eventType: "issue.closed", title: `Closed: ${issue.key}-${issue.number}`, actorId, occurredAt });
        }
      });
      return { ...issue, statusId: toStatusId };
    },

    getAvailableTransitions: async ({ actorId, issueId }) => {
      const issue = await seenOrNotFound(actorId, await loadIssue(issueId));
      const scope = { projectId: issue.projectId, issueTypeId: issue.issueTypeId, fromStatusId: issue.statusId };
      const transitions = (await isGlobalAdmin(ctx, actorId))
        ? await transitionsForScope(ctx, scope)
        : await availableTransitions(ctx, scope, await roleIdsOf(ctx, issue.projectId, actorId));
      const out: { toStatusId: string; toStatusName: string }[] = [];
      for (const t of transitions) {
        const s = await db.selectFrom("statuses").select("name").where("id", "=", t.toStatusId).executeTakeFirst();
        out.push({ toStatusId: t.toStatusId, toStatusName: s?.name ?? "" });
      }
      return { transitions: out };
    },

    listIssueStatusHistory: async ({ issueId, pagination }) => {
      const limit = pagination?.limit ?? 20;
      const cursor = decodeCursor(pagination?.cursor);
      let q = db.selectFrom("issue_status_changes").selectAll().where("issue_id", "=", issueId);
      if (cursor) {
        const sep = cursor.indexOf(" ");
        const co = cursor.slice(0, sep);
        const ci = cursor.slice(sep + 1);
        q = q.where((eb) => eb.or([eb("occurred_at", ">", co), eb.and([eb("occurred_at", "=", co), eb("id", ">", ci)])]));
      }
      const rows = await q.orderBy("occurred_at").orderBy("id").limit(limit + 1).execute();
      const items = rows.map((r) => statusChangeCodec.decode(r));
      const page = buildPage(items, (c) => `${c.occurredAt} ${c.id}`, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    listIssueScheduleHistory: async ({ issueId, pagination }) => {
      const limit = pagination?.limit ?? 20;
      const cursor = decodeCursor(pagination?.cursor);
      let q = db.selectFrom("issue_schedule_changes").selectAll().where("issue_id", "=", issueId);
      if (cursor) {
        const sep = cursor.indexOf(" ");
        const co = cursor.slice(0, sep);
        const ci = cursor.slice(sep + 1);
        q = q.where((eb) => eb.or([eb("occurred_at", ">", co), eb.and([eb("occurred_at", "=", co), eb("id", ">", ci)])]));
      }
      const rows = await q.orderBy("occurred_at").orderBy("id").limit(limit + 1).execute();
      const items = rows.map((r) => scheduleChangeCodec.decode(r));
      const page = buildPage(items, (c) => `${c.occurredAt} ${c.id}`, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    listIssueEstimationHistory: async ({ issueId, pagination }) => {
      const limit = pagination?.limit ?? 20;
      const cursor = decodeCursor(pagination?.cursor);
      let q = db.selectFrom("issue_estimation_changes").selectAll().where("issue_id", "=", issueId);
      if (cursor) {
        const sep = cursor.indexOf(" ");
        const co = cursor.slice(0, sep);
        const ci = cursor.slice(sep + 1);
        q = q.where((eb) => eb.or([eb("occurred_at", ">", co), eb.and([eb("occurred_at", "=", co), eb("id", ">", ci)])]));
      }
      const rows = await q.orderBy("occurred_at").orderBy("id").limit(limit + 1).execute();
      const items = rows.map((r) => estimationChangeCodec.decode(r));
      const page = buildPage(items, (c) => `${c.occurredAt} ${c.id}`, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    listChildIssues: async ({ parentIssueId, pagination }) => {
      const limit = pagination?.limit ?? 20;
      const cursor = decodeCursor(pagination?.cursor);
      let q = adb
        .selectFrom("issues")
        .selectAll("issues")
        .where((eb: any) =>
          eb.exists(
            eb.selectFrom("issue_parents").select("id").whereRef("issue_parents.child_issue_id", "=", "issues.id").where("issue_parents.parent_issue_id", "=", parentIssueId),
          ),
        );
      if (cursor) q = q.where("issues.id", ">", cursor);
      const rows = await q.orderBy("issues.id").limit(limit + 1).execute();
      const page = buildPage(rows.map((r: Record<string, unknown>) => issueCodec.decode(r)), (i) => i.id, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    listIssues: async (args) => {
      const f = args.filter ?? {};
      const limit = args.pagination?.limit ?? 20;
      const cursor = decodeCursor(args.pagination?.cursor);
      const dir: "asc" | "desc" = args.sortDirection === "desc" ? "desc" : "asc";
      const today = ctx.now().slice(0, 10);

      const createdAt = sql`(select min(occurred_at) from activity_entries ae where ae.target_type = 'issue' and ae.target_id = issues.id and ae.action = 'created')`;
      const updatedAt = sql`(select max(occurred_at) from activity_entries ae where ae.target_type = 'issue' and ae.target_id = issues.id)`;

      let q = adb
        .selectFrom("issues")
        .leftJoin("issue_schedules", "issue_schedules.issue_id", "issues.id")
        .selectAll("issues");

      if (f.projectId) q = q.where("issues.project_id", "=", f.projectId);
      if (f.projectIds?.length) q = q.where("issues.project_id", "in", f.projectIds);
      if (f.issueTypeIds?.length) q = q.where("issues.issue_type_id", "in", f.issueTypeIds);
      if (f.statusIds?.length) q = q.where("issues.status_id", "in", f.statusIds);
      if (f.priorityIds?.length) q = q.where("issues.priority_id", "in", f.priorityIds);
      if (f.authorId) q = q.where("issues.author_id", "=", f.authorId);
      if (f.visibility) q = q.where("issues.visibility", "=", f.visibility);
      if (f.statusCategories?.length) {
        q = q.where(sql<boolean>`(select category from statuses where statuses.id = issues.status_id) in (${sql.join(f.statusCategories)})`);
      }

      const existsSat = (table: string, col: string, vals?: string[], single?: string) => {
        if (single !== undefined) {
          q = q.where((eb: any) => eb.exists(eb.selectFrom(table).select("id").whereRef(`${table}.issue_id`, "=", "issues.id").where(`${table}.${col}`, "=", single)));
        } else if (vals && vals.length) {
          q = q.where((eb: any) => eb.exists(eb.selectFrom(table).select("id").whereRef(`${table}.issue_id`, "=", "issues.id").where(`${table}.${col}`, "in", vals)));
        }
      };
      existsSat("issue_assignees", "assignee_id", f.assigneeIds);
      existsSat("issue_labels", "label_id", f.labelIds);
      existsSat("issue_milestones", "milestone_id", undefined, f.milestoneId);
      existsSat("issue_iterations", "iteration_id", undefined, f.iterationId);
      existsSat("issue_categories", "category_id", undefined, f.categoryId);
      existsSat("issue_watchers", "user_id", undefined, f.watcherUserId);
      if (f.parentIssueId) {
        q = q.where((eb: any) => eb.exists(eb.selectFrom("issue_parents").select("id").whereRef("issue_parents.child_issue_id", "=", "issues.id").where("issue_parents.parent_issue_id", "=", f.parentIssueId)));
      }

      if (f.createdAfter) q = q.where(sql<boolean>`${createdAt} >= ${f.createdAfter}`);
      if (f.createdBefore) q = q.where(sql<boolean>`${createdAt} <= ${f.createdBefore}`);
      if (f.updatedAfter) q = q.where(sql<boolean>`${updatedAt} >= ${f.updatedAfter}`);
      if (f.updatedBefore) q = q.where(sql<boolean>`${updatedAt} <= ${f.updatedBefore}`);
      if (f.dueDateFrom) q = q.where("issue_schedules.due_date", ">=", f.dueDateFrom);
      if (f.dueDateTo) q = q.where("issue_schedules.due_date", "<=", f.dueDateTo);
      if (f.hasNoDueDate) q = q.where("issue_schedules.due_date", "is", null);
      if (f.isOverdue) {
        q = q.where(sql<boolean>`issue_schedules.due_date is not null and issue_schedules.due_date < ${today} and (select category from statuses where statuses.id = issues.status_id) != 'done'`);
      }
      if (f.query) q = q.where("issues.subject", "like", `%${f.query}%`);

      // Visibility scoped in SQL (not in app): see canSeeIssue for the policy.
      if (!(await isGlobalAdmin(ctx, args.actorId))) {
        const A = args.actorId;
        q = q.where(sql<boolean>`(
          (
            issues.author_id = ${A}
            or exists(select 1 from project_memberships pm where pm.project_id = issues.project_id and pm.user_id = ${A})
            or ((select visibility from project_categories pc where pc.project_id = issues.project_id) = 'public' and issues.visibility = 'public')
          )
          and (
            issues.author_id = ${A}
            or exists(select 1 from issue_assignees ia where ia.issue_id = issues.id and ia.assignee_id = ${A})
            or not exists(select 1 from project_memberships pm where pm.project_id = issues.project_id and pm.user_id = ${A})
            or exists(
              select 1 from project_memberships pm
              join project_membership_roles mr on mr.membership_id = pm.id
              join roles r on r.id = mr.role_id
              where pm.project_id = issues.project_id and pm.user_id = ${A} and r.issues_visibility = 'all'
            )
          )
        )`);
      }

      // Sort expression (text-comparable; numbers zero-irrelevant since we keep a
      // numeric path), with a stable id tiebreak. dueDate nulls sort last.
      const numeric = !args.sortBy || args.sortBy === "number";
      const sortExpr = numeric
        ? sql`issues.number`
        : args.sortBy === "subject"
          ? sql`issues.subject`
          : args.sortBy === "createdAt"
            ? createdAt
            : args.sortBy === "updatedAt"
              ? updatedAt
              : sql`coalesce(issue_schedules.due_date, '9999-99-99')`;

      if (cursor) {
        const sep = cursor.indexOf(" ");
        const cv = cursor.slice(0, sep);
        const ci = cursor.slice(sep + 1);
        const val = numeric ? Number(cv) : cv;
        q = dir === "asc"
          ? q.where(sql<boolean>`(${sortExpr} > ${val}) or (${sortExpr} = ${val} and issues.id > ${ci})`)
          : q.where(sql<boolean>`(${sortExpr} < ${val}) or (${sortExpr} = ${val} and issues.id < ${ci})`);
      }

      const rows: Record<string, unknown>[] = await q
        .select(sortExpr.as("sortkey"))
        .orderBy(sortExpr, dir)
        .orderBy("issues.id", dir)
        .limit(limit + 1)
        .execute();

      const hasMore = rows.length > limit;
      const pageRows = rows.slice(0, limit);
      const pageIds = pageRows.map((r) => String(r.id));
      const items: Record<string, unknown>[] = pageRows.map((r) => ({ ...issueCodec.decode(r) }));
      const byId = new Map(items.map((i) => [i.id as string, i]));

      const include: string[] = args.include ?? [];
      const attachMany = async (key: string, table: string, codec: { decode: (r: Record<string, unknown>) => unknown }) => {
        for (const i of items) (i as Record<string, unknown>)[key] = [];
        if (!pageIds.length) return;
        const sat = await adb.selectFrom(table).selectAll().where("issue_id", "in", pageIds).execute();
        for (const r of sat as Record<string, unknown>[]) ((byId.get(String(r.issue_id)) as Record<string, unknown[]>)[key]).push(codec.decode(r));
      };
      const attachOne = async (key: string, table: string, codec: { decode: (r: Record<string, unknown>) => unknown }, idCol = "issue_id") => {
        if (!pageIds.length) return;
        const sat = await adb.selectFrom(table).selectAll().where(idCol, "in", pageIds).execute();
        for (const r of sat as Record<string, unknown>[]) (byId.get(String(r[idCol])) as Record<string, unknown>)[key] = codec.decode(r);
      };
      // Hydrated variants: like attach{Many,One} but join the junction to its
      // target and decode the target resource (mirrors getIssueDetail). The
      // junction's issue id is carried out under `__iid` so rows still group by
      // issue, then dropped before the target row is decoded.
      const attachManyHydrated = async (key: string, junction: string, target: string, fk: string, codec: { decode: (r: Record<string, unknown>) => unknown }) => {
        for (const i of items) (i as Record<string, unknown>)[key] = [];
        if (!pageIds.length) return;
        const rows = await adb.selectFrom(junction)
          .innerJoin(target, `${target}.id`, `${junction}.${fk}`)
          .where(`${junction}.issue_id`, "in", pageIds)
          .select(`${junction}.issue_id as __iid`)
          .selectAll(target)
          .execute();
        for (const r of rows as Record<string, unknown>[]) {
          const iid = String(r.__iid); delete r.__iid;
          ((byId.get(iid) as Record<string, unknown[]>)[key]).push(codec.decode(r));
        }
      };
      const attachOneHydrated = async (key: string, junction: string, target: string, fk: string, codec: { decode: (r: Record<string, unknown>) => unknown }, issueCol = "issue_id") => {
        if (!pageIds.length) return;
        const rows = await adb.selectFrom(junction)
          .innerJoin(target, `${target}.id`, `${junction}.${fk}`)
          .where(`${junction}.${issueCol}`, "in", pageIds)
          .select(`${junction}.${issueCol} as __iid`)
          .selectAll(target)
          .execute();
        for (const r of rows as Record<string, unknown>[]) {
          const iid = String(r.__iid); delete r.__iid;
          (byId.get(iid) as Record<string, unknown>)[key] = codec.decode(r);
        }
      };
      if (include.includes("assignees")) await attachManyHydrated("assignees", "issue_assignees", "users", "assignee_id", userCodec);
      if (include.includes("labels")) await attachManyHydrated("labels", "issue_labels", "labels", "label_id", labelResCodec);
      if (include.includes("watchers")) await attachManyHydrated("watchers", "issue_watchers", "users", "user_id", userCodec);
      if (include.includes("relations")) await attachMany("relations", "issue_relations", relationCodec);
      if (include.includes("category")) await attachOneHydrated("category", "issue_categories", "categories", "category_id", categoryResCodec);
      if (include.includes("milestone")) await attachOneHydrated("milestone", "issue_milestones", "milestones", "milestone_id", milestoneResCodec);
      if (include.includes("iteration")) await attachOneHydrated("iteration", "issue_iterations", "iterations", "iteration_id", iterationResCodec);
      if (include.includes("parent")) await attachOneHydrated("parent", "issue_parents", "issues", "parent_issue_id", issueCodec, "child_issue_id");
      if (include.includes("schedule")) await attachOne("schedule", "issue_schedules", scheduleCodec);
      if (include.includes("estimation")) await attachOne("estimation", "issue_estimations", estimationCodec);
      if (include.includes("progress")) await attachOne("progress", "issue_progress", progressCodec);

      const last = pageRows[pageRows.length - 1];
      const nextCursor = hasMore && last
        ? Buffer.from(`${String(last.sortkey)} ${String(last.id)}`, "utf8").toString("base64url")
        : undefined;
      return { items: items as never, nextCursor };
    },
  };
}
