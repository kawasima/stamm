import { DefaultStatusSetting, WorkflowTransition } from "../../schema/index.js";
import type { WorkflowTransition as WorkflowTransitionT } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";

type WorkflowConfigMethods =
  | "listWorkflowTransitions"
  | "setWorkflowTransitions"
  | "getDefaultStatus"
  | "setDefaultStatus";

export function workflowConfigBehaviors(ctx: Ctx): Pick<Behaviors, WorkflowConfigMethods> {
  const db = ctx.db;
  const transitionCodec = makeCodec(WorkflowTransition, { json: ["roleIds"] });
  const dssCodec = makeCodec(DefaultStatusSetting);

  return {
    listWorkflowTransitions: async ({ projectId, issueTypeId, fromStatusId }) => {
      let q = db.selectFrom("workflow_transitions").selectAll().where("project_id", "=", projectId);
      if (issueTypeId) q = q.where("issue_type_id", "=", issueTypeId);
      if (fromStatusId) q = q.where("from_status_id", "=", fromStatusId);
      const rows = await q.orderBy("id").execute();
      return { transitions: rows.map((r) => transitionCodec.decode(r)) };
    },

    setWorkflowTransitions: async ({ projectId, issueTypeId, transitions }) => {
      const created: WorkflowTransitionT[] = [];
      await db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom("workflow_transitions")
          .where("project_id", "=", projectId)
          .where("issue_type_id", "=", issueTypeId)
          .execute();
        for (const t of transitions) {
          const wt = WorkflowTransition.parse({
            id: ctx.genId(),
            projectId,
            issueTypeId,
            fromStatusId: t.fromStatusId,
            toStatusId: t.toStatusId,
            roleIds: t.roleIds,
          });
          await trx.insertInto("workflow_transitions").values(transitionCodec.encode(wt) as never).execute();
          created.push(wt);
        }
      });
      return { transitions: created };
    },

    getDefaultStatus: async ({ projectId, issueTypeId }) => {
      const row = await db
        .selectFrom("default_status_settings")
        .selectAll()
        .where("project_id", "=", projectId)
        .where("issue_type_id", "=", issueTypeId)
        .executeTakeFirst();
      if (!row) throw new NotFoundError("DefaultStatusSetting", `${projectId}/${issueTypeId}`);
      return dssCodec.decode(row);
    },

    setDefaultStatus: async ({ projectId, issueTypeId, statusId }) => {
      const existing = await db
        .selectFrom("default_status_settings")
        .select("id")
        .where("project_id", "=", projectId)
        .where("issue_type_id", "=", issueTypeId)
        .executeTakeFirst();
      const dss = DefaultStatusSetting.parse({ id: existing?.id ?? ctx.genId(), projectId, issueTypeId, statusId });
      if (existing) {
        await db.updateTable("default_status_settings").set(dssCodec.encode(dss) as never).where("id", "=", dss.id).execute();
      } else {
        await db.insertInto("default_status_settings").values(dssCodec.encode(dss) as never).execute();
      }
      return dss;
    },
  };
}
