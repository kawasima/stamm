import type { z } from "zod";

/**
 * Identity pinning. Every behavior contract takes `actorId` (the operating
 * principal). When the server is constructed with a pinned actor, we hide
 * `actorId` from the published tool schemas and inject it at dispatch, so the
 * client never has to supply (or can't impersonate) an identity. With no pinned
 * actor, `actorId` stays an explicit argument.
 */
export function stripActor(shape: z.ZodRawShape, actorId: string | undefined): z.ZodRawShape {
  if (!actorId || !("actorId" in shape)) return shape;
  const { actorId: _omit, ...rest } = shape;
  return rest;
}

export function injectActor(
  args: Record<string, unknown>,
  actorId: string | undefined,
): Record<string, unknown> {
  return actorId ? { ...args, actorId } : args;
}
