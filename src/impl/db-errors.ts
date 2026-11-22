import type { Behaviors } from "../mcp/behaviors.js";
import { ConflictError, ValidationError } from "./errors.js";

/** What a database error says was violated, for SQLite and Postgres. */
function violated(err: unknown): "reference" | "unique" | undefined {
  const { code, message } = (err ?? {}) as { code?: string; message?: string };
  if (code === "23503" || code === "23001" || code === "SQLITE_CONSTRAINT_FOREIGNKEY") return "reference";
  // SQLite reports `on delete restrict` as a trigger's doing.
  if (code === "SQLITE_CONSTRAINT_TRIGGER" && message === "FOREIGN KEY constraint failed") return "reference";
  if (code === "23505" || code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") return "unique";
  return undefined;
}

/** The ids the caller gave, by name: one of them is what does not exist. */
const idFields = (args: unknown): string[] =>
  Object.keys((args ?? {}) as object).filter((k) => /Ids?$/.test(k) && k !== "actorId" && (args as Record<string, unknown>)[k] !== undefined);

/**
 * Turn the database's refusals into domain errors, for every behavior at once. The
 * database decides what may refer to what (migration 0015); this only says it in
 * terms of the call, and keeps table and column names to ourselves.
 */
export function withDbErrors(behaviors: Behaviors): Behaviors {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(behaviors)) {
    if (name === "atomically" || typeof fn !== "function") { out[name] = fn; continue; }
    out[name] = async (args: unknown) => {
      try {
        return await (fn as (a: unknown) => Promise<unknown>)(args);
      } catch (err) {
        const what = violated(err);
        if (what === "unique") throw new ConflictError("It already exists, or was written by someone else at the same time");
        if (what !== "reference") throw err;
        if (name.startsWith("delete")) throw new ConflictError("It is in use and cannot be deleted");
        throw new ValidationError(`One of these refers to something that does not exist: ${idFields(args).join(", ") || "the ids given"}`);
      }
    };
  }
  return out as unknown as Behaviors;
}
