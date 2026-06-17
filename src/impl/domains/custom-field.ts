import type { Kysely } from "kysely";
import {
  CustomFieldDefinition,
  type CustomFieldDefinition as CustomFieldDefinitionT,
  type CustomFieldValue,
  DateString,
  UrlString,
} from "../../schema/index.js";
import type { Behaviors } from "../../mcp/behaviors.js";
import type { Ctx } from "../ctx.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import { makeCodec } from "../db/codec.js";
import { buildPage, decodeCursor } from "../pagination.js";
import { assertGlobalAdmin } from "../permissions.js";

const codecOpts = {
  json: ["possibleValues", "constraints", "scope"],
  bool: ["isRequired", "isFilter", "isSearchable"],
};
const defCodec = makeCodec(CustomFieldDefinition, codecOpts);
const TABLE = "custom_field_definitions";

/** A scope list (projectIds / issueTypeIds) matches when empty/absent (= all) or it contains the id. */
const inScope = (ids: string[] | undefined, id: string): boolean => !ids || ids.length === 0 || ids.includes(id);

const loadDefs = async (db: Kysely<any>): Promise<CustomFieldDefinitionT[]> =>
  (await db.selectFrom(TABLE).selectAll().execute()).map((r: Record<string, unknown>) => defCodec.decode(r));

/** Is any issue holding a value for this field? (values live in issues.custom_fields JSON). */
const fieldInUse = async (db: Kysely<any>, fieldId: string): Promise<boolean> => {
  const rows = await db.selectFrom("issues").select("custom_fields").where("custom_fields", "like", `%${fieldId}%`).execute();
  for (const r of rows as { custom_fields: string }[]) {
    const arr = JSON.parse(r.custom_fields ?? "[]") as CustomFieldValue[];
    if (arr.some((v) => v.fieldId === fieldId)) return true;
  }
  return false;
};

const fail = (def: CustomFieldDefinitionT, msg: string): never => {
  throw new ValidationError(`Custom field "${def.name}": ${msg}`);
};

/** Validate one value against its definition's type and constraints. */
async function validateValue(ctx: Ctx, def: CustomFieldDefinitionT, value: CustomFieldValue["value"]): Promise<void> {
  const db = ctx.db as unknown as Kysely<any>;
  const c = def.constraints;
  const checkStr = (s: string) => {
    if (c.minLength !== undefined && s.length < c.minLength) fail(def, `shorter than minLength ${c.minLength}`);
    if (c.maxLength !== undefined && s.length > c.maxLength) fail(def, `longer than maxLength ${c.maxLength}`);
    if (c.regexp !== undefined && !new RegExp(c.regexp).test(s)) fail(def, `does not match ${c.regexp}`);
  };
  const checkNum = (n: number) => {
    if (c.minValue !== undefined && n < c.minValue) fail(def, `less than minValue ${c.minValue}`);
    if (c.maxValue !== undefined && n > c.maxValue) fail(def, `greater than maxValue ${c.maxValue}`);
  };
  switch (def.fieldType) {
    case "string":
    case "text":
      if (typeof value !== "string") fail(def, "expected a string");
      checkStr(value as string);
      break;
    case "url":
      if (typeof value !== "string" || !UrlString.safeParse(value).success) fail(def, "expected a URL");
      checkStr(value as string);
      break;
    case "date":
      if (typeof value !== "string" || !DateString.safeParse(value).success) fail(def, "expected a date (YYYY-MM-DD)");
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) fail(def, "expected an integer");
      checkNum(value as number);
      break;
    case "float":
      if (typeof value !== "number") fail(def, "expected a number");
      checkNum(value as number);
      break;
    case "boolean":
      if (typeof value !== "boolean") fail(def, "expected a boolean");
      break;
    case "list":
      if (typeof value !== "string") fail(def, "expected a single choice");
      if (!(def.possibleValues ?? []).includes(value as string)) fail(def, `"${value}" is not an allowed value`);
      break;
    case "multi_list":
      if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) fail(def, "expected a list of choices");
      for (const x of value as string[]) if (!(def.possibleValues ?? []).includes(x)) fail(def, `"${x}" is not an allowed value`);
      break;
    case "user": {
      if (typeof value !== "string") fail(def, "expected a user id");
      const u = await db.selectFrom("users").select("id").where("id", "=", value as string).executeTakeFirst();
      if (!u) fail(def, `no such user: ${value}`);
      break;
    }
    case "version": {
      if (typeof value !== "string") fail(def, "expected a version (milestone) id");
      const m = await db.selectFrom("milestones").select("id").where("id", "=", value as string).executeTakeFirst();
      if (!m) fail(def, `no such version: ${value}`);
      break;
    }
  }
}

/**
 * Schema-on-Write validation for an issue's custom field values (ADR-0003).
 * Each value must reference a defined field in scope for the issue's project /
 * type, conform to that field's type and constraints, and every required
 * in-scope field must be present. Throws ValidationError on the first violation.
 */
export async function validateCustomFields(
  ctx: Ctx,
  args: { projectId: string; issueTypeId: string; values: CustomFieldValue[] | undefined },
): Promise<void> {
  const values = args.values ?? [];
  const db = ctx.db as unknown as Kysely<any>;
  const defs = await loadDefs(db);
  const scoped = defs.filter((d) => inScope(d.scope.projectIds, args.projectId) && inScope(d.scope.issueTypeIds, args.issueTypeId));
  const scopedById = new Map(scoped.map((d) => [d.id, d]));
  const allById = new Map(defs.map((d) => [d.id, d]));

  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v.fieldId)) throw new ValidationError(`Duplicate custom field value: ${v.fieldId}`);
    seen.add(v.fieldId);
    const def = scopedById.get(v.fieldId);
    if (!def) {
      const known = allById.get(v.fieldId);
      throw new ValidationError(
        known
          ? `Custom field "${known.name}" is not in scope for this project / issue type`
          : `Unknown custom field: ${v.fieldId}`,
      );
    }
    await validateValue(ctx, def, v.value);
  }
  for (const d of scoped) {
    if (d.isRequired && !seen.has(d.id)) throw new ValidationError(`Custom field "${d.name}" is required`);
  }
}

type CustomFieldMethods =
  | "createCustomFieldDefinition" | "getCustomFieldDefinition" | "updateCustomFieldDefinition"
  | "deleteCustomFieldDefinition" | "listCustomFieldDefinitions";

export function customFieldBehaviors(ctx: Ctx): Pick<Behaviors, CustomFieldMethods> {
  const db = ctx.db as unknown as Kysely<any>;

  return {
    createCustomFieldDefinition: async (args) => {
      await assertGlobalAdmin(ctx, args.actorId);
      const { actorId: _a, ...fields } = args;
      const def = CustomFieldDefinition.parse({ id: ctx.genId(), ...fields });
      await db.insertInto(TABLE).values(defCodec.encode(def)).execute();
      return def;
    },

    getCustomFieldDefinition: async ({ fieldId }) => {
      const row = await db.selectFrom(TABLE).selectAll().where("id", "=", fieldId).executeTakeFirst();
      if (!row) throw new NotFoundError("CustomFieldDefinition", fieldId);
      return defCodec.decode(row);
    },

    updateCustomFieldDefinition: async (args) => {
      await assertGlobalAdmin(ctx, args.actorId);
      const row = await db.selectFrom(TABLE).selectAll().where("id", "=", args.fieldId).executeTakeFirst();
      if (!row) throw new NotFoundError("CustomFieldDefinition", args.fieldId);
      const current = defCodec.decode(row) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        if (k !== "actorId" && k !== "fieldId" && v !== undefined) patch[k] = v;
      }
      const merged = CustomFieldDefinition.parse({ ...current, ...patch, id: args.fieldId });
      await db.updateTable(TABLE).set(defCodec.encode(merged)).where("id", "=", args.fieldId).execute();
      return merged;
    },

    deleteCustomFieldDefinition: async ({ actorId, fieldId }) => {
      await assertGlobalAdmin(ctx, actorId);
      const row = await db.selectFrom(TABLE).select("id").where("id", "=", fieldId).executeTakeFirst();
      if (!row) throw new NotFoundError("CustomFieldDefinition", fieldId);
      // A definition is constitutive of its values (ADR-0003): deleting one in use
      // would void the type/meaning of values still on issues, so guard it.
      if (await fieldInUse(db, fieldId)) {
        throw new ConflictError(`Custom field ${fieldId} is in use; clear its values from issues before deleting`);
      }
      await db.deleteFrom(TABLE).where("id", "=", fieldId).execute();
    },

    listCustomFieldDefinitions: async (args) => {
      let defs = (await loadDefs(db)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      if (args.fieldType) defs = defs.filter((d) => d.fieldType === args.fieldType);
      if (typeof args.projectId === "string") defs = defs.filter((d) => inScope(d.scope.projectIds, args.projectId as string));
      if (typeof args.issueTypeId === "string") defs = defs.filter((d) => inScope(d.scope.issueTypeIds, args.issueTypeId as string));
      const limit = args.pagination?.limit ?? 20;
      const cursor = decodeCursor(args.pagination?.cursor);
      const after = cursor ? defs.filter((d) => d.id > cursor) : defs;
      const page = buildPage(after.slice(0, limit + 1), (d) => d.id, limit);
      return { items: page.items, nextCursor: page.nextCursor };
    },
  };
}
