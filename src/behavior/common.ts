import { z } from "zod";

// ============================================================
// Shared types for all behavior definitions
// ============================================================

/** Generic paginated result envelope */
export function PaginatedResult<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().optional(),
    totalCount: z.number().int().optional(),
  });
}

/** Sort direction */
export const SortDirection = z.enum(["asc", "desc"]);

export type SortDirection = z.infer<typeof SortDirection>;
