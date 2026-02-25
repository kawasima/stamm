import { z } from "zod";
import { HexColor, Resource, SortOrder } from "./common.js";

export const Priority = Resource.extend({
  name: z.string().min(1).max(100),
  color: HexColor.optional(),
  sortOrder: SortOrder,
});

export type Priority = z.infer<typeof Priority>;
