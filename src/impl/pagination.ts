/**
 * Keyset pagination. A cursor is the last-seen item's sort key (base64url). List
 * queries fetch `limit + 1` ordered rows; `buildPage` keeps `limit`, and if a
 * surplus row was fetched, emits a `nextCursor` from the last kept item. This
 * survives insertions (unlike offset pagination).
 */

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export function encodeCursor(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): string | undefined {
  return cursor ? Buffer.from(cursor, "base64url").toString("utf8") : undefined;
}

export function buildPage<T>(rows: T[], keyOf: (t: T) => string, limit: number): Page<T> {
  if (rows.length > limit) {
    const items = rows.slice(0, limit);
    return { items, nextCursor: encodeCursor(keyOf(items[items.length - 1])) };
  }
  return { items: rows };
}
