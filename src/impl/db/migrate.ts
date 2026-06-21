import type { Kysely } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import * as init0001 from "./migrations/0001_init.js";
import * as issues0002 from "./migrations/0002_issues.js";
import * as planning0003 from "./migrations/0003_planning.js";
import * as time0004 from "./migrations/0004_time.js";
import * as notifications0005 from "./migrations/0005_notifications.js";
import * as credentials0006 from "./migrations/0006_user_credentials.js";
import * as workspace0007 from "./migrations/0007_workspace.js";
import * as changeEvents0008 from "./migrations/0008_change_events.js";
import * as customFields0009 from "./migrations/0009_custom_fields.js";
import * as indexes0010 from "./migrations/0010_indexes.js";

/** All migrations in order, keyed by a sortable name. */
const MIGRATIONS: Record<string, Migration> = {
  "0001_init": init0001,
  "0002_issues": issues0002,
  "0003_planning": planning0003,
  "0004_time": time0004,
  "0005_notifications": notifications0005,
  "0006_user_credentials": credentials0006,
  "0007_workspace": workspace0007,
  "0008_change_events": changeEvents0008,
  "0009_custom_fields": customFields0009,
  "0010_indexes": indexes0010,
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return MIGRATIONS;
  }
}

/** Apply all pending migrations. Throws on the first failure. */
export async function migrateToLatest(db: Kysely<any>): Promise<void> {
  const migrator = new Migrator({ db, provider: new StaticMigrationProvider() });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(String(error));
}
