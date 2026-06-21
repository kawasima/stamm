import { describe, it, expect } from "vitest";
import { IssueFilter } from "./filter.js";
import { CustomFieldConstraints, CustomFieldValue } from "./custom-field.js";
import { Issue } from "./issue.js";

/**
 * Input bounds that keep a single request from becoming a storage/CPU DoS.
 * Unbounded arrays fan out into per-item DB work; an unbounded LIKE query forces
 * full scans; an unbounded custom-field regexp is a ReDoS lever. These caps are
 * the boundary that the MCP layer validates every request against.
 */
describe("validation bounds", () => {
  it("caps the free-text issue query length", () => {
    expect(() => IssueFilter.parse({ query: "x".repeat(10_000) })).toThrow();
    expect(IssueFilter.parse({ query: "login" }).query).toBe("login");
  });

  it("caps filter id-list lengths", () => {
    const huge = Array.from({ length: 5_000 }, (_, i) => `id-${i}`);
    expect(() => IssueFilter.parse({ statusIds: huge })).toThrow();
    expect(() => IssueFilter.parse({ assigneeIds: huge })).toThrow();
  });

  it("caps the number of custom field values on an issue", () => {
    const many = Array.from({ length: 5_000 }, (_, i) => ({ fieldId: `f-${i}`, value: "v" }));
    expect(() =>
      Issue.parse({ id: "i1", projectId: "p1", issueTypeId: "t1", priorityId: "pr1", statusId: "s1", authorId: "a1", key: "K", number: 1, subject: "s", visibility: "public", customFields: many }),
    ).toThrow();
  });

  it("caps a custom field value string length", () => {
    expect(() => CustomFieldValue.parse({ fieldId: "f1", value: "x".repeat(100_000) })).toThrow();
    expect(CustomFieldValue.parse({ fieldId: "f1", value: "ok" }).value).toBe("ok");
  });

  it("caps a custom-field constraint regexp length (ReDoS lever)", () => {
    expect(() => CustomFieldConstraints.parse({ regexp: "a".repeat(5_000) })).toThrow();
    expect(CustomFieldConstraints.parse({ regexp: "^[0-9]+$" }).regexp).toBe("^[0-9]+$");
  });
});
