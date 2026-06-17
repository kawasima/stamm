import type { z } from "zod";

/**
 * Raoh-style boundary codec. The DB is a boundary: a raw row is `decode`d into a
 * validated domain value (via the Zod schema's `parse` — parse, don't validate),
 * and a domain value is `encode`d back into a row. Domain code never touches raw
 * rows. Column names are snake_case in storage and camelCase in the domain; the
 * codec converts mechanically. Fields listed in `json` are stored as JSON text.
 */
export interface RowCodec<T> {
  decode(row: Record<string, unknown>): T;
  encode(value: T): Record<string, unknown>;
}

export interface CodecOptions {
  /** Domain field names (camelCase) persisted as JSON text columns. */
  json?: string[];
  /** Domain field names (camelCase) persisted as 0/1 integers (SQLite has no boolean). */
  bool?: string[];
}

const toSnake = (s: string): string => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const toCamel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export function makeCodec<S extends z.ZodTypeAny>(
  schema: S,
  opts: CodecOptions = {},
): RowCodec<z.infer<S>> {
  const jsonFields = new Set(opts.json ?? []);
  const boolFields = new Set(opts.bool ?? []);

  return {
    decode(row) {
      const obj: Record<string, unknown> = {};
      for (const [col, raw] of Object.entries(row)) {
        if (raw === null || raw === undefined) continue; // SQL NULL -> absent (optional)
        const key = toCamel(col);
        if (jsonFields.has(key) && typeof raw === "string") obj[key] = JSON.parse(raw);
        else if (boolFields.has(key)) obj[key] = !!raw; // 0/1 -> boolean
        else obj[key] = raw;
      }
      return schema.parse(obj);
    },

    encode(value) {
      const parsed = schema.parse(value) as Record<string, unknown>;
      const row: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(parsed)) {
        if (v === undefined) continue;
        if (jsonFields.has(key)) row[toSnake(key)] = JSON.stringify(v);
        else if (boolFields.has(key)) row[toSnake(key)] = v ? 1 : 0;
        else row[toSnake(key)] = v;
      }
      return row;
    },
  };
}
