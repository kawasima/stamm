import { z } from "zod";

// ============================================================
// Primitive Value Objects
// ============================================================

/** Branded ID type - all entities use string IDs (UUIDs or nanoids) */
export const Id = z.string().min(1);

/** ISO 8601 datetime string */
export const Timestamp = z.string().datetime();

/** ISO 8601 date string (no time) */
export const DateString = z.string().date();

/** Hex color code (#RRGGBB) */
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Markdown text content */
export const MarkdownContent = z.string().max(200000);

/** Email address */
export const EmailAddress = z.string().email();

/** URL string */
export const UrlString = z.string().url();

/** Percentage value (0-100) */
export const Percentage = z.number().int().min(0).max(100);

/** Positive hours (for time tracking / estimation) */
export const Hours = z.number().min(0);

/** URL-safe slug identifier */
export const Slug = z.string().min(1).max(300).regex(/^[a-z0-9-]+$/);

/** Sort order for ordered collections */
export const SortOrder = z.number().int().default(0);

// ============================================================
// Composite Value Objects
// ============================================================

/** Date range with optional start and end */
export const DateRange = z.object({
  startDate: DateString.optional(),
  endDate: DateString.optional(),
});

/** Human-readable issue key like "PROJ-123" */
export const IssueKey = z.object({
  key: z.string().min(1).max(50),
  number: z.number().int().positive(),
});

/** Polymorphic target reference (type + id pair) */
export const TargetRef = z.object({
  targetType: z.string().min(1),
  targetId: Id,
});

/** File metadata */
export const FileInfo = z.object({
  filename: z.string().min(1).max(500),
  contentType: z.string().max(200),
  sizeBytes: z.number().int().min(0),
});

// ============================================================
// Base Schemas
// ============================================================

/**
 * Resource base - no timestamp. Resources are timeless entities.
 * If you need a timestamp, extract an Event instead.
 */
export const Resource = z.object({
  id: Id,
});

/**
 * Event base - exactly one timestamp (occurredAt).
 * Each event captures a single moment in time.
 */
export const Event = z.object({
  id: Id,
  occurredAt: Timestamp,
});

/**
 * Long-term event base - has a lifecycle with status.
 * Status is the only field allowed to be UPDATEd.
 */
export const LongTermEvent = z.object({
  id: Id,
  status: z.string().min(1),
});

/** Pagination cursor envelope (for API consumers) */
export const PaginationParams = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

// ============================================================
// Type exports
// ============================================================

export type Id = z.infer<typeof Id>;
export type Timestamp = z.infer<typeof Timestamp>;
export type DateString = z.infer<typeof DateString>;
export type HexColor = z.infer<typeof HexColor>;
export type MarkdownContent = z.infer<typeof MarkdownContent>;
export type EmailAddress = z.infer<typeof EmailAddress>;
export type UrlString = z.infer<typeof UrlString>;
export type Percentage = z.infer<typeof Percentage>;
export type Hours = z.infer<typeof Hours>;
export type Slug = z.infer<typeof Slug>;
export type SortOrder = z.infer<typeof SortOrder>;
export type DateRange = z.infer<typeof DateRange>;
export type IssueKey = z.infer<typeof IssueKey>;
export type TargetRef = z.infer<typeof TargetRef>;
export type FileInfo = z.infer<typeof FileInfo>;
export type Resource = z.infer<typeof Resource>;
export type Event = z.infer<typeof Event>;
export type LongTermEvent = z.infer<typeof LongTermEvent>;
export type PaginationParams = z.infer<typeof PaginationParams>;
