import { describe, expect, it } from "vitest";
import { SIMPLE_TOOLS } from "./catalog.js";
import { CREATE, DELETE, GET, LIST, UPDATE } from "./admin.js";
import { contractArgsObject } from "./contract.js";

/**
 * Access can only be decided where the caller is known. A contract without a
 * required `actorId` is one the permission layer cannot check, so it leaks by
 * construction. There are no exceptions; a read that truly needs no check still
 * says who is reading.
 */
describe("every exposed contract names its actor", () => {
  const contracts = [
    ...SIMPLE_TOOLS.map((t) => [t.name, t.contract] as const),
    ...Object.entries({ create: CREATE, get: GET, update: UPDATE, delete: DELETE, list: LIST }).flatMap(([op, map]) =>
      Object.entries(map).map(([resource, e]) => [`admin_${op}:${resource}`, e.contract] as const)),
  ];
  it.each(contracts)("%s", (_name, contract) => {
    const actor = contractArgsObject(contract).shape.actorId;
    expect(actor).toBeDefined();
    expect(actor!.isOptional()).toBe(false);
  });
});
