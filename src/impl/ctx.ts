import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "./db/schema.js";

/**
 * Ambient context threaded through every behavior: the database handle plus
 * injectable `now()` and `genId()`. Injecting these (rather than calling
 * Date/uuid inline) keeps ids, cursors, and timestamps deterministic in tests.
 */
export interface Ctx {
  db: Kysely<Database>;
  now: () => string;
  genId: () => string;
}

export interface CtxOptions {
  now?: () => string;
  genId?: () => string;
}

export function makeCtx(db: Kysely<Database>, opts: CtxOptions = {}): Ctx {
  return {
    db,
    now: opts.now ?? (() => new Date().toISOString()),
    genId: opts.genId ?? (() => randomUUID()),
  };
}
