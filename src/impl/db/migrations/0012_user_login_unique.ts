import { sql, type Kysely } from "kysely";

/**
 * `@login` mentions address a user by login, so a login must name one user.
 * Compared case-insensitively: mentions are matched that way.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`create unique index users_login_lower_unique on users (lower(login))`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop index users_login_lower_unique`.execute(db);
}
