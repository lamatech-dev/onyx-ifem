export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
  maxClients?: number;
  idleTtlMs?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
  seenAt: number;
}

const OVERFLOW_KEY = "\u0000overflow";
const INFRASTRUCTURE_GET_PATHS = new Set(["/healthz", "/readyz", "/metrics"]);

export function isAdmissionExempt(method: string | undefined, pathname: string): boolean {
  return method === "GET" && INFRASTRUCTURE_GET_PATHS.has(pathname);
}

export class TokenBucketRateLimiter {
  readonly #capacity: number;
  readonly #refillPerMillisecond: number;
  readonly #maxClients: number;
  readonly #idleTtlMs: number;
  readonly #buckets = new Map<string, Bucket>();
  #nextSweepAt = 0;

  constructor(options: TokenBucketOptions) {
    this.#capacity = positiveNumber(options.capacity, "capacity");
    this.#refillPerMillisecond = positiveNumber(options.refillPerSecond, "refillPerSecond") / 1_000;
    this.#maxClients = positiveInteger(options.maxClients ?? 10_000, "maxClients", 1_000_000);
    this.#idleTtlMs = positiveInteger(options.idleTtlMs ?? 600_000, "idleTtlMs", 86_400_000);
  }

  get trackedClients(): number {
    return this.#buckets.size - (this.#buckets.has(OVERFLOW_KEY) ? 1 : 0);
  }

  consume(clientKey: string, nowMs: number, cost = 1): RateLimitDecision {
    if (!clientKey) throw new Error("rate-limit client key is required");
    if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error("rate-limit time must be a non-negative finite number");
    positiveNumber(cost, "rate-limit cost");
    this.#removeExpired(nowMs);
    const key = this.#buckets.has(clientKey) || this.trackedClients < this.#maxClients ? clientKey : OVERFLOW_KEY;
    const bucket = this.#buckets.get(key) ?? {tokens: this.#capacity, updatedAt: nowMs, seenAt: nowMs};
    const effectiveNow = Math.max(nowMs, bucket.updatedAt);
    const elapsed = effectiveNow - bucket.updatedAt;
    bucket.tokens = Math.min(this.#capacity, bucket.tokens + elapsed * this.#refillPerMillisecond);
    bucket.updatedAt = effectiveNow;
    bucket.seenAt = Math.max(bucket.seenAt, nowMs);
    const allowed = bucket.tokens >= cost;
    if (allowed) bucket.tokens -= cost;
    this.#buckets.set(key, bucket);
    const deficit = allowed ? 0 : cost - bucket.tokens;
    return {
      allowed,
      remaining: Math.max(0, Math.floor(bucket.tokens)),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(deficit / this.#refillPerMillisecond / 1_000)),
    };
  }

  #removeExpired(nowMs: number): void {
    if (nowMs < this.#nextSweepAt) return;
    this.#nextSweepAt = nowMs + Math.min(this.#idleTtlMs, 60_000);
    for (const [key, bucket] of this.#buckets) {
      if (key !== OVERFLOW_KEY && nowMs - bucket.seenAt >= this.#idleTtlMs) this.#buckets.delete(key);
    }
  }
}

export class ConcurrencyGate {
  readonly #maximum: number;
  #active = 0;

  constructor(maximum: number) {
    this.#maximum = positiveInteger(maximum, "maximum concurrency", 1_000_000);
  }

  get active(): number {
    return this.#active;
  }

  enter(): (() => void) | undefined {
    if (this.#active >= this.#maximum) return undefined;
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
    };
  }
}

export type AdmissionDecision =
  | {accepted: true; remaining: number; release: () => void}
  | {accepted: false; status: 429; code: "RATE_LIMITED"; retryAfterSeconds: number; remaining: 0}
  | {accepted: false; status: 503; code: "DEPENDENCY_UNAVAILABLE"; retryAfterSeconds: 1; remaining: number};

export class HttpAdmissionController {
  readonly #limiter: TokenBucketRateLimiter;
  readonly #gate: ConcurrencyGate;

  constructor(limiter: TokenBucketRateLimiter, gate: ConcurrencyGate) {
    this.#limiter = limiter;
    this.#gate = gate;
  }

  admit(clientKey: string, nowMs: number): AdmissionDecision {
    const rate = this.#limiter.consume(clientKey, nowMs);
    if (!rate.allowed) {
      return {accepted: false, status: 429, code: "RATE_LIMITED", retryAfterSeconds: rate.retryAfterSeconds, remaining: 0};
    }
    const release = this.#gate.enter();
    if (!release) {
      return {accepted: false, status: 503, code: "DEPENDENCY_UNAVAILABLE", retryAfterSeconds: 1, remaining: rate.remaining};
    }
    return {accepted: true, remaining: rate.remaining, release};
  }
}

function positiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer from 1 through ${maximum}`);
  return value;
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number`);
  return value;
}
