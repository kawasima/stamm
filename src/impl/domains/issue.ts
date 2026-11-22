import {
  Issue,
  IssueDetail,
  IssueSchedule,
  IssueEstimation,
  IssueProgress,
  IssueRelation,
  UserRef,
  Label,
  Category,
  Milestone,
  Iteration,
} from "../../schema/index.js";
import { IssueEstimationChange } from "../../schema/index.js";
import type { Issue as IssueT } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js";
import { sql } from "kysely";
import { makeCodec } from "../db/codec.js";
import { appendActivity } from "../timeline.js";
import { recordEstimationChange, recordScheduleChange, recordStatusChange } from "../issue-events.js";
import { notifyIssueEvent } from "../notifications.js";
import { assertCanWrite, isGlobalAdmin, isMember, roleIdsOf, assertAssignable } from "../permissions.js";
import { assertCanReadIssue, issueVisible, readableIssueIds } from "../issue-visibility.js";
import { buildPage, decodeCursor } from "../pagination.js";
import { assertTransitionAllowed, availableTransitions, resolveDefaultStatus, transitionsForScope } from "../workflow.js";
import { validateCustomFields } from "./custom-field.js";
import { assertInProject, PROJECT_ATTACHMENTS } from "../references.js";
import { inTransaction } from "../tx.js";

type IssueMethods =
  | "createIssue" | "getIssue" | "getIssueByKey" | "getIssueDetail"
  | "updateIssue" | "deleteIssue" | "moveIssue"
  | "transitionIssueStatus" | "getAvailableTransitions"
  | "listIssues" | "listChildIssues";

export function issueBehaviors(ctx: Ctx): Pick<Behaviors, IssueMethods> {
  const db = ctx.db;
  const issueCodec = makeCodec(Issue, { json: ["customFields"] });
  const scheduleCodec = makeCodec(IssueSchedule);
  const estimationCodec = makeCodec(IssueEstimation);
  const progressCodec = makeCodec(IssueProgress);
  const relationCodec = makeCodec(IssueRelation);
  // Codecs for the resources a detail view hydrates its satellites into.
  const userCodec = makeCodec(UserRef);
  const labelResCodec = makeCodec(Label);
  const categoryResCodec = makeCodec(Category);
  const milestoneResCodec = makeCodec(Milestone);
  const iterationResCodec = makeCodec(Iteration);

  const loadIssue = async (issueId: string): Promise<IssueT> => {
    const row = await db.selectFrom("issues").selectAll().where("id", "=", issueId).executeTakeFirst();
    if (!row) throw new NotFoundError("Issue", issueId);
    return issueCodec.decode(row);
  };

  const seenOrNotFound = async (actorId: string, issue: IssueT): Promise<IssueT> => {
    await assertCanReadIssue(ctx, issue.id, actorId);
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
      await assertAssignable(ctx, args.projectId, args.assigneeIds ?? []);
      await assertInProject(db, args.projectId, "labels", args.labelIds ?? []);
      await assertInProject(db, args.projectId, "categories", [args.categoryId]);
      await assertInProject(db, args.projectId, "milestones", [args.milestoneId]);
      if (args.parentIssueId) await assertCanReadIssue(ctx, args.parentIssueId, args.actorId);
      const statusId = args.statusId ?? (await resolveDefaultStatus(ctx, args.projectId, args.issueTypeId)).id;

      let issue!: IssueT;
      // One instant for the whole creation: the issue, its first history and the feed.
      const occurredAt = ctx.now();
      await inTransaction(db, async (trx) => {
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
        await recordStatusChange(ctx, trx, { issueId: iid, userId: args.actorId, toStatusId: statusId, occurredAt });
        if (args.assigneeIds?.length) {
          await trx.insertInto("issue_assignees").values(args.assigneeIds.map((assigneeId) => ({ id: ctx.genId(), issue_id: iid, assignee_id: assigneeId }))).execute();
        }
        if (args.labelIds?.length) {
          await trx.insertInto("issue_labels").values(args.labelIds.map((labelId) => ({ id: ctx.genId(), issue_id: iid, label_id: labelId }))).execute();
        }
        if (args.categoryId) await trx.insertInto("issue_categories").values({ id: ctx.genId(), issue_id: iid, category_id: args.categoryId }).execute();
        if (args.milestoneId) await trx.insertInto("issue_milestones").values({ id: ctx.genId(), issue_id: iid, milestone_id: args.milestoneId }).execute();
        if (args.parentIssueId) await trx.insertInto("issue_parents").values({ id: ctx.genId(), child_issue_id: iid, parent_issue_id: args.parentIssueId }).execute();
        if (args.startDate !== undefined || args.dueDate !== undefined) {
          await trx.insertInto("issue_schedules").values({ id: ctx.genId(), issue_id: iid, start_date: args.startDate ?? null, due_date: args.dueDate ?? null }).execute();
          await recordScheduleChange(ctx, trx, { issueId: iid, projectId: args.projectId, userId: args.actorId, from: {}, to: { startDate: args.startDate, dueDate: args.dueDate }, occurredAt });
        }
        if (args.estimatedHours !== undefined) {
          await trx.insertInto("issue_estimations").values({ id: ctx.genId(), issue_id: iid, estimated_hours: args.estimatedHours }).execute();
          await recordEstimationChange(ctx, trx, { issueId: iid, projectId: args.projectId, userId: args.actorId, fromHours: null, toHours: args.estimatedHours, occurredAt });
        }
        await appendActivity(ctx, trx, { projectId: args.projectId, userId: args.actorId, action: "created", targetType: "issue", targetId: iid, occurredAt });
        await notifyIssueEvent(ctx, trx, { projectId: args.projectId, issueId: iid, authorId: args.actorId, eventType: "issue.created", title: `${issue.key}-${issue.number}: ${issue.subject}`, actorId: args.actorId, occurredAt });
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
      // The parent (and relations) may live in another project; show them only if
      // the actor could read them directly.
      const linked = [...(parent ? [parent.id] : []), ...relations.map((r) => r.relatedIssueId)];
      const readable = await readableIssueIds(ctx, actorId, linked);
      const visibleParent = parent && readable.has(parent.id) ? parent : undefined;
      const visibleRelations = relations.filter((r) => readable.has(r.relatedIssueId));
      return IssueDetail.parse({ ...issue, assignees, labels, watchers, relations: visibleRelations, category, milestone, iteration, parent: visibleParent, schedule, estimation, progress });
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
      // Write only the columns the caller changed. Rewriting the whole row from
      // the snapshot read above would silently revert a concurrent update to a
      // different field.
      const encoded = issueCodec.encode(merged) as Record<string, unknown>;
      const columnOf: Record<string, string> = {
        issueTypeId: "issue_type_id", priorityId: "priority_id", subject: "subject",
        description: "description", visibility: "visibility", customFields: "custom_fields",
      };
      const changed = Object.fromEntries(Object.keys(patch).map((f) => [columnOf[f], encoded[columnOf[f]]]));
      await inTransaction(db, async (trx) => {
        if (Object.keys(changed).length > 0) {
          await trx.updateTable("issues").set(changed as never).where("id", "=", merged.id).execute();
        }
        await appendActivity(ctx, trx, { projectId: merged.projectId, userId: args.actorId, action: "updated", targetType: "issue", targetId: merged.id });
      });
      return merged;
    },

    deleteIssue: async ({ actorId, issueId }) => {
      const issue = await loadIssue(issueId);
      await assertCanWrite(ctx, issue.projectId, actorId, "issue.delete");
      await inTransaction(db, async (trx) => {
        // Delete the Resource (the issue); its current state goes with it (cascade).
        // The Events stay: issue_status_changes / issue_schedule_changes /
        // issue_estimation_changes / activity_entries are append-only and may
        // still be referenced (e.g. by flow metrics), so they survive — the
        // deletion itself is recorded as a `deleted` activity. (See the
        // immutable data model: Resources are deletable, Events are not.)
        await appendActivity(ctx, trx, { projectId: issue.projectId, userId: actorId, action: "deleted", targetType: "issue", targetId: issueId });
        await trx.deleteFrom("issues").where("id", "=", issueId).execute();
      });
    },

    moveIssue: async ({ actorId, issueId, targetProjectId, newIssueTypeId }) => {
      const issue = await loadIssue(issueId);
      await assertCanWrite(ctx, issue.projectId, actorId, "issue.move");
      const targetProj = await db.selectFrom("projects").select("identifier").where("id", "=", targetProjectId).executeTakeFirst();
      if (!targetProj) throw new NotFoundError("Project", targetProjectId);
      // Moving an issue INTO a project is a write there too — require move rights
      // in the destination, not just the source.
      await assertCanWrite(ctx, targetProjectId, actorId, "issue.move");
      let moved!: IssueT;
      await inTransaction(db, async (trx) => {
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
        // What belongs to the project it leaves doesn't come along, nor do assignees
        // who are not members where it goes.
        for (const t of PROJECT_ATTACHMENTS) await trx.deleteFrom(t).where("issue_id", "=", issueId).execute();
        await trx.deleteFrom("issue_assignees").where("issue_id", "=", issueId)
          .where("assignee_id", "not in", (eb) => eb.selectFrom("project_memberships").select("user_id").where("project_id", "=", targetProjectId)).execute();
        await appendActivity(ctx, trx, { projectId: targetProjectId, userId: actorId, action: "updated", targetType: "issue", targetId: issueId });
      });
      return moved;
    },

    transitionIssueStatus: async ({ actorId, issueId, toStatusId, expectedStatusId }) => {
      const issue = await seenOrNotFound(actorId, await loadIssue(issueId));
      const fromStatusId = issue.statusId;
      if (expectedStatusId !== undefined && expectedStatusId !== fromStatusId) {
        throw new ConflictError(`Issue ${issueId} is in status ${fromStatusId}, not the expected ${expectedStatusId}`);
      }
      if (!(await isGlobalAdmin(ctx, actorId))) {
        // A workflow rule with empty roleIds means "any member", so membership
        // itself has to be checked here; the rule check below doesn't do it.
        if (!(await isMember(ctx, issue.projectId, actorId))) {
          throw new ForbiddenError(`User ${actorId} is not a member of project ${issue.projectId}`);
        }
        const roleIds = await roleIdsOf(ctx, issue.projectId, actorId);
        await assertTransitionAllowed(ctx, { projectId: issue.projectId, issueTypeId: issue.issueTypeId, fromStatusId }, toStatusId, roleIds);
      }
      const toCategory = (await db.selectFrom("statuses").select("category").where("id", "=", toStatusId).executeTakeFirst())?.category;
      const occurredAt = ctx.now();
      await inTransaction(db, async (trx) => {
        // Compare-and-set on the status the workflow check ran against, so a
        // concurrent transition can't be silently overwritten (and the recorded
        // from-status stays truthful). Throwing rolls the transaction back.
        const res = await trx.updateTable("issues").set({ status_id: toStatusId }).where("id", "=", issueId).where("status_id", "=", fromStatusId).executeTakeFirst();
        if (Number(res.numUpdatedRows) === 0) {
          throw new ConflictError(`Issue ${issueId} changed status concurrently; reload and retry`);
        }
        await recordStatusChange(ctx, trx, { issueId, userId: actorId, fromStatusId, toStatusId, occurredAt });
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
      const toIds = [...new Set(transitions.map((t) => t.toStatusId))];
      const names = new Map<string, string>();
      if (toIds.length) {
        const rows = await db.selectFrom("statuses").select(["id", "name"]).where("id", "in", toIds).execute();
        for (const r of rows) names.set(r.id, r.name);
      }
      const out = transitions.map((t) => ({ toStatusId: t.toStatusId, toStatusName: names.get(t.toStatusId) ?? "" }));
      return { transitions: out };
    },

    listChildIssues: async ({ actorId, parentIssueId, pagination }) => {
      await assertCanReadIssue(ctx, parentIssueId, actorId);
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
      q = q.where(await issueVisible(ctx, actorId));
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

      q = q.where(await issueVisible(ctx, args.actorId));

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

      // A parent or related issue may be one the actor can't read.
      const linked = items.flatMap((i) => [
        ...(i.parent ? [(i.parent as { id: string }).id] : []),
        ...((i.relations as { relatedIssueId: string }[] | undefined) ?? []).map((r) => r.relatedIssueId),
      ]);
      if (linked.length > 0) {
        const readable = await readableIssueIds(ctx, args.actorId, linked);
        for (const i of items) {
          if (i.parent && !readable.has((i.parent as { id: string }).id)) delete i.parent;
          if (i.relations) i.relations = (i.relations as { relatedIssueId: string }[]).filter((r) => readable.has(r.relatedIssueId));
        }
      }

      const last = pageRows[pageRows.length - 1];
      const nextCursor = hasMore && last
        ? Buffer.from(`${String(last.sortkey)} ${String(last.id)}`, "utf8").toString("base64url")
        : undefined;
      return { items: items as never, nextCursor };
    },
  };
}
