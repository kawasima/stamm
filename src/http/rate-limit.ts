/**
 * In-process limits for the HTTP server. Two separate concerns, with separate keys:
 *
 * - {@link CallLimiter} shares the server fairly between authenticated callers and
 *   stops a runaway one. Its key is the credential, because that is what identifies a
 *   client: several clients share an address behind a bridge, a proxy or a NAT, and
 *   one user can run several clients. It counts calls, not HTTP requests, since one
 *   request can carry a batch.
 * - {@link FailureLimiter} bounds work spent on callers that don't authenticate. The
 *   address is all that is known about them, and only their failures count, so it
 *   never limits someone whose requests succeed.
 *
 * Both are per process. Several processes behind a load balancer each have their own;
 * a limit across them, or on raw traffic, belongs to the proxy in front.
 */

/** Refuse a request; `retryAfterSec` is when to try again. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterSec: number) {
    super("rate limit exceeded");
  }
}

const MAX_ENTRIES = 10_000;

/**
 * Token buckets: each key may spend up to `capacity` at once, refilled at
 * `perMinute`. Over any minute a key gets at most capacity + perMinute.
 */
class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(readonly perMinute: number, readonly capacity: number) {}

  private level(key: string, now: number): number {
    const b = this.buckets.get(key);
    return b ? Math.min(this.capacity, b.tokens + (Math.max(0, now - b.at) / 60_000) * this.perMinute) : this.capacity;
  }

  /** Spend `cost`, or return how many seconds until that much is there. */
  take(key: string, cost: number, now: number): number | undefined {
    const tokens = this.level(key, now);
    if (tokens < cost) return Math.max(1, Math.ceil(((cost - tokens) / this.perMinute) * 60));
    this.put(key, tokens - cost, now);
    return undefined;
  }

  /** Spend `cost` as far as it goes. */
  drain(key: string, cost: number, now: number): void {
    this.put(key, Math.max(0, this.level(key, now) - cost), now);
  }

  give(key: string, amount: number, now: number): void {
    this.put(key, Math.min(this.capacity, this.level(key, now) + amount), now);
  }

  private put(key: string, tokens: number, at: number): void {
    // Re-inserting keeps the map ordered by last use, oldest first.
    this.buckets.delete(key);
    // A full bucket is the same as none.
    if (tokens < this.capacity) this.buckets.set(key, { tokens, at });
    if (this.buckets.size > MAX_ENTRIES) this.buckets.delete(this.buckets.keys().next().value!);
  }

  get size(): number { return this.buckets.size; }
}

export class CallLimiter {
  private readonly buckets: TokenBuckets;
  /** The most calls one request may carry. */
  readonly maxBatch: number;
  constructor(perMinute: number, burst = Math.max(1, Math.ceil(perMinute / 3))) {
    this.buckets = new TokenBuckets(perMinute, burst);
    this.maxBatch = burst;
  }
  spend(keyId: string, calls: number, now: number): void {
    const wait = this.buckets.take(keyId, calls, now);
    if (wait !== undefined) throw new RateLimitedError(wait);
  }
}

/** How long a key that authenticated from an address is let past that address's failures. */
const TRUST_MS = 5 * 60_000;

export class FailureLimiter {
  private readonly buckets: TokenBuckets;
  private readonly proven = new Map<string, number>();
  constructor(perMinute: number) {
    this.buckets = new TokenBuckets(perMinute, perMinute);
  }

  /**
   * Run `authenticate` for a request from `address` claiming the key `claimedKid`.
   * The attempt is paid for up front and refunded when it succeeds, so concurrent
   * attempts can't overrun the limit. A key that recently authenticated from this
   * address is let through even when others there have used it up: otherwise one
   * client retrying a revoked key would lock out everyone behind the same bridge.
   */
  async guard<T>(address: string, claimedKid: string | undefined, now: () => number, authenticate: () => Promise<T>): Promise<T> {
    const ip = addressBlock(address);
    const pair = `${ip} ${claimedKid ?? ""}`;
    const trusted = claimedKid !== undefined && (this.proven.get(pair) ?? 0) > now();
    if (!trusted) {
      const wait = this.buckets.take(ip, 1, now());
      if (wait !== undefined) throw new RateLimitedError(wait);
    }
    const result = await authenticate().catch((err: unknown) => {
      if (trusted) this.buckets.drain(ip, 1, now());
      throw err;
    });
    if (!trusted) this.buckets.give(ip, 1, now());
    if (claimedKid !== undefined) {
      this.proven.delete(pair);
      this.proven.set(pair, now() + TRUST_MS);
      if (this.proven.size > MAX_ENTRIES) this.proven.delete(this.proven.keys().next().value!);
    }
    return result;
  }

  /** Exposed for tests: how many addresses are being tracked. */
  get tracked(): number { return this.buckets.size; }
}

/** An address as one party: an IPv4 address, or the /64 an IPv6 host can move within. */
export function addressBlock(address: string): string {
  const v4 = /^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (v4) return v4[1]!;
  if (!address.includes(":")) return address;
  const [head = "", tail] = address.toLowerCase().split("%")[0]!.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = !tail ? [] : tail.split(":");
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
