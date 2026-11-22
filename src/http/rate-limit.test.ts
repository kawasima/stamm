import { describe, expect, it } from "vitest";
import { addressBlock, CallLimiter, FailureLimiter, RateLimitedError } from "./rate-limit.js";

describe("CallLimiter", () => {
  it("bounds what a key gets over any minute by its burst plus its rate", () => {
    const l = new CallLimiter(600); // 200 at once
    let granted = 0;
    for (let t = 0; t < 60_000; t += 50) {
      for (let i = 0; i < 10; i++) {
        try { l.spend("k", 1, t); granted++; } catch (e) { if (!(e instanceof RateLimitedError)) throw e; }
      }
    }
    expect(granted).toBeGreaterThan(780);
    expect(granted).toBeLessThanOrEqual(800);
  });

  it("is not fooled by a clock that steps back", () => {
    const l = new CallLimiter(3);
    l.spend("k", 1, 1_000_000);
    expect(() => l.spend("k", 1, 0)).toThrow(RateLimitedError);
  });
});

describe("FailureLimiter", () => {
  const fail = async () => { throw new Error("no"); };

  it("holds under concurrent attempts", async () => {
    const l = new FailureLimiter(5);
    let ran = 0;
    const slow = async () => { ran++; await new Promise((r) => setTimeout(r, 5)); throw new Error("no"); };
    await Promise.allSettled(Array.from({ length: 50 }, () => l.guard("10.0.0.1", undefined, () => 0, slow)));
    expect(ran).toBe(5);
  });

  it("does not grow without bound as addresses come and go", async () => {
    const l = new FailureLimiter(5);
    for (let i = 0; i < 10_500; i++) await l.guard(`10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`, undefined, () => 0, fail).catch(() => {});
    expect(l.tracked).toBeLessThanOrEqual(10_000);
  });

  it("keeps nothing for an address whose requests succeed", async () => {
    const l = new FailureLimiter(5);
    await l.guard("10.0.0.1", "kid", () => 0, async () => 1);
    expect(l.tracked).toBe(0);
  });
});

describe("addressBlock", () => {
  it.each([
    ["10.0.0.1", "10.0.0.1"], ["::ffff:10.0.0.1", "10.0.0.1"], ["unknown", "unknown"],
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"], ["2001:db8:1:2::9", "2001:db8:1:2::/64"], ["2001:0db8:0001:0002::", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"], ["fe80::1%en0", "fe80:0:0:0::/64"], ["::1", "0:0:0:0::/64"],
  ])("%s is %s", (address, block) => expect(addressBlock(address)).toBe(block));
});
