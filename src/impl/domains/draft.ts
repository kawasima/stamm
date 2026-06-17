import { DraftIssue, DraftConversion } from "../../schema/index.js";
import type { DraftIssue as DraftIssueT } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { assertCanWrite } from "../permissions.js";
import { buildPage, decodeCursor } from "../pagination.js";
import { appendActivity } from "../timeline.js";
import { issueBehaviors } from "./issue.js";

type DraftMethods =
  | "createDraftIssue" | "getDraftIssue" | "updateDraftIssue" | "deleteDraftIssue"
  | "listDraftIssues" | "convertDraftToIssue";

/**
 * Draft issues are proto-issues that live only on a board until promoted. They
 * have no dedicated permission, so they reuse the issue.* permissions: a draft
 * is an issue-in-waiting. Promotion composes the real {@link issueBehaviors.createIssue}
 * (so it inherits the default-status resolution, key sequence, and activity log)
 * and records a DraftConversion linking the draft to the new issue.
 */
export function draftBehaviors(ctx: Ctx): Pick<Behaviors, DraftMethods> {
  const db = ctx.db;
  const codec = makeCodec(DraftIssue);
  const conversionCodec = makeCodec(DraftConversion);
  const issues = issueBehaviors(ctx);

  const load = async (id: string): Promise<DraftIssueT> => {
    const row = await db.selectFrom("draft_issues").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundError("DraftIssue", id);
    return codec.decode(row);
  };

  return {
    createDraftIssue: async ({ actorId, projectId, title, body, sortOrder }) => {
      await assertCanWrite(ctx, projectId, actorId, "issue.create");
      const draft = DraftIssue.parse({ id: ctx.genId(), projectId, title, body, authorId: actorId, sortOrder });
      await db.insertInto("draft_issues").values(codec.encode(draft) as never).execute();
      return draft;
    },

    getDraftIssue: async ({ draftId }) => load(draftId),

    updateDraftIssue: async (args) => {
      const draft = await load(args.draftId);
      await assertCanWrite(ctx, draft.projectId, args.actorId, "issue.update");
      const patch: Record<string, unknown> = {};
      for (const f of ["title", "body", "sortOrder"] as const) {
        if ((args as Record<string, unknown>)[f] !== undefined) patch[f] = (args as Record<string, unknown>)[f];
      }
      const merged = DraftIssue.parse({ ...draft, ...patch });
      await db.updateTable("draft_issues").set(codec.encode(merged) as never).where("id", "=", merged.id).execute();
      return merged;
    },

    deleteDraftIssue: async ({ actorId, draftId }) => {
      const draft = await load(draftId);
      await assertCanWrite(ctx, draft.projectId, actorId, "issue.delete");
      await db.deleteFrom("draft_issues").where("id", "=", draftId).execute();
    },

    listDraftIssues: async ({ projectId, pagination }) => {
      const limit = pagination?.limit ?? 20;
      const cursor = decodeCursor(pagination?.cursor);
      let q = db.selectFrom("draft_issues").selectAll().where("project_id", "=", projectId);
      if (cursor) q = q.where("id", ">", cursor);
      const rows = await q.orderBy("id").limit(limit + 1).execute();
      const page = buildPage(rows.map((r) => codec.decode(r)), (d) => d.id, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },

    convertDraftToIssue: async ({ draftId, issueTypeId, priorityId, statusId, actorId }) => {
      const draft = await load(draftId);
      // createIssue asserts issue.create on the draft's project and resolves the
      // default status when statusId is omitted.
      const issue = await issues.createIssue({
        actorId, projectId: draft.projectId, issueTypeId, priorityId,
        ...(statusId !== undefined ? { statusId } : {}),
        subject: draft.title, ...(draft.body !== undefined ? { description: draft.body } : {}),
      });
      const conversion = DraftConversion.parse({ id: ctx.genId(), draftId, issueId: issue.id, userId: actorId, occurredAt: ctx.now() });
      await db.insertInto("draft_conversions").values(conversionCodec.encode(conversion) as never).execute();
      await appendActivity(ctx, db, { projectId: draft.projectId, userId: actorId, action: "draft_converted", targetType: "issue", targetId: issue.id });
      return { issue, conversion };
    },
  };
}
