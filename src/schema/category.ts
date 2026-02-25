import { z } from "zod";
import { Id, Resource } from "./common.js";

export const Category = Resource.extend({
  projectId: Id,
  name: z.string().min(1).max(100),
});

export type Category = z.infer<typeof Category>;
