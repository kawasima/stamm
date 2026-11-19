import { describe, it, expect } from "vitest";
import { isRestricted, parseScopeEnv } from "./stdio-scope.js";

describe("parseScopeEnv", () => {
  it("treats unset and blank as unrestricted", () => {
    expect(parseScopeEnv(undefined)).toEqual({});
    expect(parseScopeEnv("  ")).toEqual({});
    expect(isRestricted({})).toBe(false);
  });
  it("parses readOnly and projectIds", () => {
    const s = parseScopeEnv('{"readOnly":true,"projectIds":["p1"]}');
    expect(s).toEqual({ readOnly: true, projectIds: ["p1"] });
    expect(isRestricted(s)).toBe(true);
  });
  it("rejects bad JSON, unknown keys and empty project lists", () => {
    expect(() => parseScopeEnv("{")).toThrow(/not valid JSON/);
    expect(() => parseScopeEnv('{"readonly":true}')).toThrow(/invalid/);
    expect(() => parseScopeEnv('{"projectIds":[]}')).toThrow(/invalid/);
  });
});
