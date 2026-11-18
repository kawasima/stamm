import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "./db/schema.js";
import type { KeyScope } from "../schema/index.js";

/**
 * Ambient context threaded through every behavior: the database handle plus
 * injectable `now()` and `genId()`. Injecting these (rather than calling
 * Date/uuid inline) keeps ids, cursors, and timestamps deterministic in tests.
 */
export interface Ctx {
  db: Kysely<Database>;
  now: () => string;
  genId: () => string;
  /**
   * Restriction carried by the key the caller authenticated with. Unset for
   * trusted in-process callers (stdio, tests, seeding). The permission layer
   * reads it, so every behavior built on this ctx honours it.
   */
  scope?: KeyScope;
}

export interface CtxOptions {
  now?: () => string;
  genId?: () => string;
  scope?: KeyScope;
}

export function makeCtx(db: Kysely<Database>, opts: CtxOptions = {}): Ctx {
  return {
    db,
    now: opts.now ?? (() => new Date().toISOString()),
    genId: opts.genId ?? (() => randomUUID()),
    ...(opts.scope ? { scope: opts.scope } : {}),
  };
}
