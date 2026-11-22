import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import { world } from "./test-world.js";

const page = { pagination: { limit: 100 } };

describe("a list that says where something applies", () => {
  it("keeps what it lists from being deleted, and never grows by a deletion", async () => {
    const { b, A, priv, pub, s } = await world();
    const type = await b.createIssueType({ actorId: A, name: "T" });
    const empty = await b.createProject({ actorId: A, identifier: "empty", name: "E" });
    const f = await b.createCustomFieldDefinition({ actorId: A, name: "f", fieldType: "string", constraints: {}, scope: { projectIds: [empty.id], issueTypeIds: [type.id] } });
    await expect(b.deleteProject({ actorId: A, projectId: empty.id })).rejects.toBeInstanceOf(ConflictError);
    await expect(b.deleteIssueType({ actorId: A, issueTypeId: type.id })).rejects.toBeInstanceOf(ConflictError);
    expect((await b.getCustomFieldDefinition({ actorId: A, fieldId: f.id })).scope).toEqual({ projectIds: [empty.id], issueTypeIds: [type.id] });
    await b.updateCustomFieldDefinition({ actorId: A, fieldId: f.id, scope: { projectIds: [pub, priv, pub] } });
    expect((await b.getCustomFieldDefinition({ actorId: A, fieldId: f.id })).scope).toEqual({ projectIds: [pub, priv] }); // order kept, once each
    await b.deleteProject({ actorId: A, projectId: empty.id });
    await b.deleteIssueType({ actorId: A, issueTypeId: type.id });
    await b.deleteCustomFieldDefinition({ actorId: A, fieldId: f.id });
    void s;
  });

  it("can't list what does not exist", async () => {
    const { b, A } = await world();
    for (const scope of [{ projectIds: ["nope"] }, { issueTypeIds: ["nope"] }]) {
      await expect(b.createCustomFieldDefinition({ actorId: A, name: "f", fieldType: "string", constraints: {}, scope })).rejects.toBeInstanceOf(ValidationError);
    }
    expect((await b.listCustomFieldDefinitions({ actorId: A, ...page })).items.map((f) => f.name)).not.toContain("f");
  });

  it("decides who may make a transition as before", async () => {
    const { b, A, pub, s, insider, limited, ids, shown, ofLimited } = await world();
    const [all] = ids.roleId!;
    await b.setWorkflowTransitions({ actorId: A, projectId: pub, issueTypeId: s.issueTypeId, transitions: [
      { fromStatusId: s.statusIds.todo, toStatusId: s.statusIds.done, roleIds: [all!] },
      { fromStatusId: s.statusIds.todo, toStatusId: s.statusIds.inProgress, roleIds: [] },
    ] });
    const open = async (actorId: string, issueId: string) => (await b.getAvailableTransitions({ actorId, issueId })).transitions.map((t) => t.toStatusId).sort();
    await b.transitionIssueStatus({ actorId: A, issueId: shown.id, toStatusId: s.statusIds.todo });
    expect(await open(insider.id, shown.id)).toEqual([s.statusIds.done, s.statusIds.inProgress].sort());
    expect(await open(limited.id, ofLimited.id)).toEqual([s.statusIds.inProgress]);
    await expect(b.transitionIssueStatus({ actorId: limited.id, issueId: ofLimited.id, toStatusId: s.statusIds.done })).rejects.toBeInstanceOf(ForbiddenError);
    const listed = (await b.listWorkflowTransitions({ actorId: A, projectId: pub })).transitions;
    expect(listed.map((t) => t.roleIds).sort()).toEqual([[], [all!]].sort());
  });
});

describe("a template", () => {
  it("is refused what could not be used, when it is written", async () => {
    const { b, A, pub, ids, outsider } = await world();
    const t = { actorId: A, projectId: pub, name: "t", descriptionTemplate: "" };
    const list = await b.createCustomFieldDefinition({ actorId: A, name: "l", fieldType: "list", possibleValues: ["a"], constraints: {}, scope: {} });
    for (const over of [
      { defaultLabelIds: [ids.labelId![1]!] }, { defaultAssigneeIds: [outsider.id] }, { defaultCustomFields: [{ fieldId: "nope", value: "x" }] },
      { defaultCustomFields: [{ fieldId: list.id, value: "b" }] }, { defaultCustomFields: [{ fieldId: ids.fieldId![1]!, value: "x" }] },
    ]) {
      await expect(b.createIssueTemplate({ ...t, ...over }), JSON.stringify(over)).rejects.toBeInstanceOf(ValidationError);
      await expect(b.updateIssueTemplate({ actorId: A, templateId: ids.templateId![0]!, ...over }), JSON.stringify(over)).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("lets go of what is deleted or leaves, and offers only what an issue would take", async () => {
    const { b, A, pub, s, insider } = await world();
    const label = await b.createLabel({ actorId: A, projectId: pub, name: "l", color: "#000000" });
    const kept = await b.createLabel({ actorId: A, projectId: pub, name: "k", color: "#000000" });
    const f = await b.createCustomFieldDefinition({ actorId: A, name: "f", fieldType: "list", possibleValues: ["a", "b"], constraints: {}, scope: {} });
    const t = await b.createIssueTemplate({ actorId: A, projectId: pub, name: "t", descriptionTemplate: "", issueTypeId: s.issueTypeId, defaultPriorityId: s.priorityId, defaultLabelIds: [label.id, kept.id], defaultAssigneeIds: [insider.id], defaultCustomFields: [{ fieldId: f.id, value: "a" }] });
    expect(t).toMatchObject({ defaultLabelIds: [label.id, kept.id], defaultAssigneeIds: [insider.id] });
    const prepared = async () => b.instantiateTemplate({ actorId: A, templateId: t.id, subject: "x" });
    expect(await prepared()).toMatchObject({ labelIds: [label.id, kept.id], assigneeIds: [insider.id], customFields: [{ fieldId: f.id, value: "a" }] });
    await b.deleteLabel({ actorId: A, labelId: label.id });
    await b.removeProjectMember({ actorId: A, projectId: pub, userId: insider.id });
    await b.updateCustomFieldDefinition({ actorId: A, fieldId: f.id, possibleValues: ["b"] });
    const p = await prepared();
    expect([p.labelIds, p.assigneeIds, p.customFields]).toEqual([[kept.id], undefined, []]);
    const { priorityId, issueTypeId, ...rest } = p;
    await b.createIssue({ actorId: A, ...rest, issueTypeId: issueTypeId!, priorityId: priorityId!, statusId: s.statusIds.todo });
    expect((await b.listIssueTemplates({ actorId: A, projectId: pub, ...page })).items.find((x) => x.id === t.id)!.defaultLabelIds).toEqual([kept.id]);
  });
});

describe("a user or version held as a field value", () => {
  it("can't be deleted, and a version is one of the issue's project", async () => {
    const { b, A, pub, priv, s, ids } = await world();
    const ver = await b.createCustomFieldDefinition({ actorId: A, name: "v", fieldType: "version", constraints: {}, scope: {} });
    const usr = await b.createCustomFieldDefinition({ actorId: A, name: "u", fieldType: "user", constraints: {}, scope: {} });
    const m = await b.createMilestone({ actorId: A, projectId: pub, name: "m" });
    const u = await b.createUser({ actorId: A, login: "z", email: "z@x.io", displayName: "z" });
    const base = { actorId: A, projectId: pub, issueTypeId: s.issueTypeId, priorityId: s.priorityId, statusId: s.statusIds.todo, subject: "x" };
    const hidden = ids.milestoneId![1]!;
    const tell = (id: string) => b.createIssue({ ...base, customFields: [{ fieldId: ver.id, value: id }] }).catch((e: Error) => `${e.name} ${e.message.replace(id, "?")}`);
    expect(await tell(hidden)).toBe(await tell("nope"));
    const i = await b.createIssue({ ...base, customFields: [{ fieldId: ver.id, value: m.id }, { fieldId: usr.id, value: u.id }] });
    await expect(b.deleteMilestone({ actorId: A, milestoneId: m.id })).rejects.toBeInstanceOf(ConflictError);
    await expect(b.deleteUser({ actorId: A, userId: u.id })).rejects.toBeInstanceOf(ConflictError);
    await expect(b.moveIssue({ actorId: A, issueId: i.id, targetProjectId: priv })).rejects.toBeInstanceOf(ValidationError);
    await b.updateIssue({ actorId: A, issueId: i.id, customFields: i.customFields }); // still writable as it is
    await b.updateIssue({ actorId: A, issueId: i.id, customFields: [] });
    await b.deleteMilestone({ actorId: A, milestoneId: m.id });
    await b.deleteUser({ actorId: A, userId: u.id });
  });
});

describe("a draft", () => {
  it("lasts until it becomes an issue, once", async () => {
    const { db, b, A, pub, s } = await world();
    const d = await b.createDraftIssue({ actorId: A, projectId: pub, title: "idea", body: "why" });
    const c = { actorId: A, draftId: d.id, issueTypeId: s.issueTypeId, priorityId: s.priorityId, statusId: s.statusIds.todo };
    const { issue, conversion } = await b.convertDraftToIssue(c);
    expect(issue).toMatchObject({ subject: "idea", description: "why" });
    for (const f of [() => b.convertDraftToIssue(c), () => b.getDraftIssue({ actorId: A, draftId: d.id }), () => b.updateDraftIssue({ actorId: A, draftId: d.id, title: "x" }), () => b.deleteDraftIssue({ actorId: A, draftId: d.id })]) {
      await expect(f()).rejects.toBeInstanceOf(NotFoundError);
    }
    expect((await b.listDraftIssues({ actorId: A, projectId: pub, ...page })).items.map((x) => x.id)).not.toContain(d.id);
    expect(await db.selectFrom("draft_conversions").selectAll().execute()).toMatchObject([{ id: conversion.id, draft_id: d.id, issue_id: issue.id }]);
  });

  it("becomes one issue when converted twice at once", async () => {
    const { b, A, pub, s } = await world();
    const d = await b.createDraftIssue({ actorId: A, projectId: pub, title: "twice" });
    const c = { actorId: A, draftId: d.id, issueTypeId: s.issueTypeId, priorityId: s.priorityId, statusId: s.statusIds.todo };
    const done = await Promise.allSettled([b.convertDraftToIssue(c), b.convertDraftToIssue(c)]);
    expect(done.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await b.listIssues({ actorId: A, filter: { query: "twice" }, ...page })).items).toHaveLength(1);
  });
});

describe("a private view", () => {
  it("is its owner's: no one else makes, changes, reorders or deletes it", async () => {
    const w = await world();
    const { b, A, pub, insider, limited, personal, ofLimited } = w;
    await expect(b.createProjectView({ actorId: limited.id, projectId: pub, ownerId: insider.id, name: "v", filter: {}, visibility: "private" })).rejects.toBeInstanceOf(ForbiddenError);
    const at = { actorId: limited.id, viewId: personal.id };
    for (const f of [() => b.updateProjectView({ ...at, visibility: "public" }), () => b.deleteProjectView(at), () => b.moveIssueOnBoard({ ...at, issueId: ofLimited.id, position: 1 })]) {
      await expect(f()).rejects.toBeInstanceOf(NotFoundError);
    }
    expect((await b.createProjectView({ actorId: limited.id, projectId: pub, name: "mine", filter: {} })).ownerId).toBe(limited.id);
    expect((await b.createProjectView({ actorId: A, projectId: pub, ownerId: insider.id, name: "for", filter: {} })).ownerId).toBe(insider.id);
    await b.updateProjectView({ actorId: insider.id, viewId: personal.id, name: "renamed" });
  });
});
