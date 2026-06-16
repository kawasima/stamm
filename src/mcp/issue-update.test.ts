import { describe, it, expect } from "vitest";
import { connect, stubBehaviors, validIssue } from "./test-helpers.js";

describe("issue_update (compound fan-out)", () => {
  it("dispatches only the satellites that were supplied, then returns the hydrated issue", async () => {
    const seen: Record<string, unknown> = {};
    const client = await connect(
      stubBehaviors({
        updateIssue: async (args) => {
          seen.updateIssue = args;
          return validIssue;
        },
        setIssueLabels: async (args) => {
          seen.setIssueLabels = args;
          return { labels: [] };
        },
        setIssueMilestone: async (args) => {
          seen.setIssueMilestone = args;
          return { id: "im1", issueId: "i1", milestoneId: "m1" };
        },
        getIssueDetail: async (args) => {
          seen.getIssueDetail = args;
          return { ...validIssue, assignees: [], labels: [], watchers: [], relations: [] };
        },
      }),
    );

    const result = await client.callTool({
      name: "issue_update",
      arguments: {
        actorId: "u1",
        issueId: "i1",
        subject: "Renamed",
        labelIds: ["l1", "l2"],
        milestoneId: "m1",
      },
    });

    // core fields routed to updateIssue
    expect(seen.updateIssue).toMatchObject({ actorId: "u1", issueId: "i1", subject: "Renamed" });
    // supplied satellites routed to their setters
    expect(seen.setIssueLabels).toEqual({ actorId: "u1", issueId: "i1", labelIds: ["l1", "l2"] });
    expect(seen.setIssueMilestone).toEqual({ actorId: "u1", issueId: "i1", milestoneId: "m1" });
    // an omitted satellite (assignees) must NOT be touched
    expect(seen.setIssueAssignees).toBeUndefined();
    // result is the re-hydrated detail
    expect(seen.getIssueDetail).toEqual({ actorId: "u1", issueId: "i1" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: "i1", labels: [] });
  });
});
