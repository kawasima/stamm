import { z } from "zod";
import { Event, FileInfo, Id, TargetRef } from "./common.js";

// ============================================================
// Event (E) - uploading a file is an event
// ============================================================

export const Attachment = Event
  .merge(TargetRef)
  .merge(FileInfo)
  .extend({
    authorId: Id,
    description: z.string().max(500).optional(),
    storageKey: z.string().min(1),
  });

export type Attachment = z.infer<typeof Attachment>;
