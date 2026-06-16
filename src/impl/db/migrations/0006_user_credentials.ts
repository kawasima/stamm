import type { Kysely } from "kysely";

/**
 * Per-user JWT signing credentials. The server stores only the EdDSA PUBLIC
 * key (as a JWK in text); the private key is shown once at issuance and never
 * persisted. `key_id` is the JWT `kid` used to disambiguate a user's keys.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("user_credentials")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("user_id", "text", (c) => c.notNull())
    .addColumn("key_id", "text", (c) => c.notNull())
    .addColumn("algorithm", "text", (c) => c.notNull())
    .addColumn("public_key", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("revoked_at", "text")
    .execute();
  await db.schema
    .createIndex("user_credentials_user_idx")
    .on("user_credentials")
    .column("user_id")
    .execute();
  await db.schema
    .createIndex("user_credentials_kid_idx")
    .on("user_credentials")
    .column("key_id")
    .unique()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("user_credentials").execute();
}
