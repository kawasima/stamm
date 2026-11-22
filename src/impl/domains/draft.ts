import { inTransaction } from "../tx.js";
import { sql } from "kysely";
import { DraftIssue, DraftConversion } from "../../schema/index.js";
import type { DraftIssue as DraftIssueT } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { assertCanWrite, assertCanReadProject } from "../permissions.js";
import { listPage } from "../listing.js";
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

  const load = async (id: string, from = db): Promise<DraftIssueT> => {
    const row = await from.selectFrom("draft_issues").selectAll().where("id", "=", id).executeTakeFirst();
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

    getDraftIssue: async ({ actorId, draftId }) => {
      const draft = await load(draftId);
      await assertCanReadProject(ctx, draft.projectId, actorId);
      return draft;
    },

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

    listDraftIssues: async ({ actorId, projectId, pagination }) => {
      await assertCanReadProject(ctx, projectId, actorId);
      let q = db.selectFrom("draft_issues").selectAll().where("project_id", "=", projectId);
      const page = await listPage(q, { name: "drafts", keys: [{ by: sql.ref("sort_order"), dir: "asc" }] }, "id", pagination);
      return { items: page.items.map((r) => codec.decode(r)), nextCursor: page.nextCursor };
    },

    convertDraftToIssue: ({ draftId, issueTypeId, priorityId, statusId, actorId }) => inTransaction(db, async (trx) => {
      const draft = await load(draftId, trx);
      // createIssue asserts issue.create on the draft's project and resolves the
      // default status when statusId is omitted.
      const issue = await issueBehaviors({ ...ctx, db: trx }).createIssue({
        actorId, projectId: draft.projectId, issueTypeId, priorityId,
        ...(statusId !== undefined ? { statusId } : {}),
        subject: draft.title, ...(draft.body !== undefined ? { description: draft.body } : {}),
      });
      const conversion = DraftConversion.parse({ id: ctx.genId(), draftId, issueId: issue.id, userId: actorId, occurredAt: ctx.now() });
      await trx.insertInto("draft_conversions").values(conversionCodec.encode(conversion) as never).execute();
      await appendActivity(ctx, trx, { projectId: draft.projectId, userId: actorId, action: "draft_converted", targetType: "issue", targetId: issue.id });
      return { issue, conversion };
    }),
  };
}
