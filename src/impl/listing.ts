import { sql, type RawBuilder } from "kysely";
import { ValidationError } from "./errors.js";

/**
 * How every listing sorts, pages, matches text and reads date bounds. A listing says
 * what it is sorted by and gets the rest: the order, the cursor, and the check that
 * a cursor is its own.
 */

export interface Page<T> { items: T[]; nextCursor?: string }

export type Dir = "asc" | "desc";

/** Something to sort by: an expression that is never null (see {@link nullsLast}). */
export interface SortKey { by: RawBuilder<unknown>; dir: Dir }
/** A named order. The id is added as the last key, so the order is total. */
export interface Sort { name: string; keys: SortKey[] }

type Value = string | number;
const encode = (tag: string, values: Value[]): string => Buffer.from(JSON.stringify([tag, ...values]), "utf8").toString("base64url");

function decode(cursor: string, tag: string, length: number): Value[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    parsed = undefined;
  }
  const [head, ...values] = Array.isArray(parsed) ? (parsed as unknown[]) : [];
  const ok = head === tag && values.length === length && values.every((v) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v)));
  // Continuing under another order would skip and repeat rows without a sign of it.
  if (!ok) throw new ValidationError("This cursor is not from a listing with the same order. Start again without one");
  return values as Value[];
}

/**
 * A page of `query` in the order of `sort`. `id` is the column that breaks ties.
 * Rows come back as the query selected them.
 */
export async function listPage(
  // A Kysely select whose table is chosen at run time; the caller's codec types the rows.
  query: any,
  sort: Sort,
  id: string,
  pagination: { limit?: number | undefined; cursor?: string | undefined } | undefined,
): Promise<Page<Record<string, unknown>>> {
  const limit = pagination?.limit ?? 20;
  const keys: SortKey[] = [...sort.keys, { by: sql.ref(id), dir: sort.keys.at(-1)?.dir ?? "asc" }];
  const tag = `${sort.name}:${keys.map((k) => k.dir).join()}`;
  let q = query;
  if (pagination?.cursor) {
    const at = decode(pagination.cursor, tag, keys.length);
    // after (a, b, id): a beyond, or a equal and b beyond, or both equal and id beyond
    const beyond = keys.map((k, i) => {
      const equal = keys.slice(0, i).map((e, n) => sql`${e.by} = ${at[n]}`);
      return sql`(${sql.join([...equal, sql`${k.by} ${sql.raw(k.dir === "asc" ? ">" : "<")} ${at[i]}`], sql` and `)})`;
    });
    q = q.where(sql<boolean>`(${sql.join(beyond, sql` or `)})`);
  }
  keys.forEach((k, i) => { q = q.select(k.by.as(`__key${i}`)).orderBy(k.by, k.dir); });
  const rows: Record<string, unknown>[] = await q.limit(limit + 1).execute();
  const items = rows.slice(0, limit);
  const last = rows.length > limit ? items.at(-1) : undefined;
  const nextCursor = last && encode(tag, keys.map((_, i) => last[`__key${i}`] as Value));
  for (const r of items) keys.forEach((_, i) => delete r[`__key${i}`]);
  return { items, ...(nextCursor ? { nextCursor } : {}) };
}

/** The same for items already in memory, ascending by `keyOf`, whose last part is unique. */
export function arrayPage<T>(
  items: T[],
  name: string,
  keyOf: (t: T) => Value[],
  pagination: { limit?: number | undefined; cursor?: string | undefined } | undefined,
): Page<T> {
  const limit = pagination?.limit ?? 20;
  const compare = (a: Value[], b: Value[]): number => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
    return 0;
  };
  let sorted = [...items].sort((a, b) => compare(keyOf(a), keyOf(b)));
  if (pagination?.cursor && sorted[0]) {
    const at = decode(pagination.cursor, name, keyOf(sorted[0]).length);
    sorted = sorted.filter((t) => compare(keyOf(t), at) > 0);
  }
  const page = sorted.slice(0, limit);
  return { items: page, ...(sorted.length > limit ? { nextCursor: encode(name, keyOf(page.at(-1)!)) } : {}) };
}

/** Sort keys for an expression that may be null: those with a value first, either way. */
export const nullsLast = (by: RawBuilder<unknown>, dir: Dir): SortKey[] => [
  { by: sql`case when ${by} is null then 1 else 0 end`, dir: "asc" },
  { by: sql`coalesce(${by}, '')`, dir },
];

/** A text sort that ignores case. */
export const text = (column: string, dir: Dir): SortKey => ({ by: sql`lower(${sql.ref(column)})`, dir });

/** The expression contains `needle`, taken literally. */
export const contains = (by: RawBuilder<unknown>, needle: string): RawBuilder<boolean> =>
  sql<boolean>`${by} like ${`%${needle.replace(/[\\%_]/g, "\\$&")}%`} escape '\\'`;

/** An instant as stored: ISO with milliseconds, so that comparing as text is comparing times. */
export const stored = (instant: string): string => new Date(instant).toISOString();

/** An instant falls on `day` (UTC) or later. */
export const onOrAfter = (instant: RawBuilder<unknown>, day: string): RawBuilder<boolean> => sql<boolean>`${instant} >= ${day}`;

/** An instant falls on `day` (UTC) or earlier, the whole day included. */
export function onOrBefore(instant: RawBuilder<unknown>, day: string): RawBuilder<boolean> {
  const next = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  return sql<boolean>`${instant} < ${next}`;
}
