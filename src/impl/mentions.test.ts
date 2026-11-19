import { describe, it, expect } from "vitest";
import { extractMentions } from "./mentions.js";

describe("extractMentions", () => {
  it("finds logins, case-insensitively and once each", () => {
    expect(extractMentions("hi @Alice and @bob, @alice again")).toEqual(["alice", "bob"]);
  });
  it("leaves sentence punctuation out of the login", () => {
    expect(extractMentions("thanks @bob. ok @carol-x? @dave_")).toEqual(["bob", "carol-x", "dave"]);
  });
  it("ignores email addresses and a bare @", () => {
    expect(extractMentions("mail bob@example.com or @ nobody, a@@b")).toEqual([]);
  });
  it("allows dots inside a login", () => {
    expect(extractMentions("@first.last please look")).toEqual(["first.last"]);
  });
});
