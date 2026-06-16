import { UserCategory, GroupMembership, User } from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { ConflictError, NotFoundError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { assertGlobalAdmin } from "../permissions.js";
import { buildPage, decodeCursor } from "../pagination.js";

type UserExtraMethods = "setUserStatus" | "getUserStatus" | "addGroupMember" | "removeGroupMember" | "listGroupMembers";

export function userExtraBehaviors(ctx: Ctx): Pick<Behaviors, UserExtraMethods> {
  const db = ctx.db;
  const statusCodec = makeCodec(UserCategory);
  const membershipCodec = makeCodec(GroupMembership);
  const userCodec = makeCodec(User);

  return {
    setUserStatus: async ({ actorId, userId, status }) => {
      await assertGlobalAdmin(ctx, actorId);
      const existing = await db.selectFrom("user_statuses").select("id").where("user_id", "=", userId).executeTakeFirst();
      const value = UserCategory.parse({ id: existing?.id ?? ctx.genId(), userId, status });
      if (existing) await db.updateTable("user_statuses").set(statusCodec.encode(value) as never).where("id", "=", value.id).execute();
      else await db.insertInto("user_statuses").values(statusCodec.encode(value) as never).execute();
      return value;
    },

    getUserStatus: async ({ userId }) => {
      const row = await db.selectFrom("user_statuses").selectAll().where("user_id", "=", userId).executeTakeFirst();
      if (!row) throw new NotFoundError("UserStatus", userId);
      return statusCodec.decode(row);
    },

    addGroupMember: async ({ actorId, groupId, userId }) => {
      await assertGlobalAdmin(ctx, actorId);
      const existing = await db.selectFrom("group_memberships").select("id").where("group_id", "=", groupId).where("user_id", "=", userId).executeTakeFirst();
      if (existing) throw new ConflictError(`User ${userId} is already in group ${groupId}`);
      const m = GroupMembership.parse({ id: ctx.genId(), groupId, userId });
      await db.insertInto("group_memberships").values(membershipCodec.encode(m) as never).execute();
      return m;
    },

    removeGroupMember: async ({ actorId, groupId, userId }) => {
      await assertGlobalAdmin(ctx, actorId);
      const res = await db.deleteFrom("group_memberships").where("group_id", "=", groupId).where("user_id", "=", userId).executeTakeFirst();
      if (Number(res.numDeletedRows ?? 0) === 0) throw new NotFoundError("GroupMembership", `${groupId}/${userId}`);
    },

    listGroupMembers: async ({ groupId, pagination }) => {
      const limit = pagination?.limit ?? 20;
      const cursor = decodeCursor(pagination?.cursor);
      let q = db
        .selectFrom("group_memberships as gm")
        .innerJoin("users as u", "u.id", "gm.user_id")
        .selectAll("u")
        .where("gm.group_id", "=", groupId);
      if (cursor) q = q.where("u.id", ">", cursor);
      const rows = await q.orderBy("u.id").limit(limit + 1).execute();
      const page = buildPage(rows.map((r) => userCodec.decode(r)), (u) => u.id, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },
  };
}
