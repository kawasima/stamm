import { describe, it, expect } from "vitest";
import { buildPage, encodeCursor, decodeCursor } from "./pagination.js";

describe("keyset pagination", () => {
  it("round-trips a cursor", () => {
    expect(decodeCursor(encodeCursor("id-42"))).toBe("id-42");
    expect(decodeCursor(undefined)).toBeUndefined();
  });

  it("emits nextCursor when more rows than the limit were fetched", () => {
    // fetch limit+1 to detect a next page
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const page = buildPage(rows, (r) => r.id, 2);
    expect(page.items.map((r) => r.id)).toEqual(["a", "b"]);
    expect(decodeCursor(page.nextCursor)).toBe("b");
  });

  it("omits nextCursor on the last page", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const page = buildPage(rows, (r) => r.id, 2);
    expect(page.items.map((r) => r.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBeUndefined();
  });
});
