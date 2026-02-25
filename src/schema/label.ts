import { z } from "zod";
import { HexColor, Id, Resource } from "./common.js";

export const Label = Resource.extend({
  projectId: Id,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color: HexColor,
});

export type Label = z.infer<typeof Label>;
