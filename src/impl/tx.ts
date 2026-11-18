import type { Kysely } from "kysely";

/**
 * Run `fn` atomically. On a plain database this opens a transaction; when `db`
 * is already a transaction (a behavior set bound to one, see
 * {@link Behaviors.atomically}) it runs `fn` on it directly, because Kysely does
 * not support nesting `transaction()` and a single SQLite connection would
 * block on the outer one. The enclosing transaction then owns commit/rollback.
 */
export function inTransaction<DB, T>(db: Kysely<DB>, fn: (trx: Kysely<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? fn(db) : db.transaction().execute(fn);
}
