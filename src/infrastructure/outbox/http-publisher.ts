import type { OutboxMessage } from "../sqlite/database.ts";

export interface HttpEventPublisherOptions {
  url: string;
  bearerToken?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function createHttpEventPublisher(options: HttpEventPublisherOptions): (message: OutboxMessage) => Promise<void> {
  const url = new URL(options.url);
  if (url.protocol !== "https:") throw new Error("outbox publisher URL must use HTTPS");
  if (url.username || url.password) throw new Error("outbox publisher URL must not contain credentials");
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error("outbox publisher timeout must be from 100 through 120000 milliseconds");
  }
  const request = options.fetch ?? globalThis.fetch;
  return async (message) => {
    const response = await request(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "content-type": "application/json",
        "idempotency-key": message.eventId,
        "x-onyx-context": message.context,
        "x-onyx-aggregate-id": message.aggregateId,
        "x-onyx-aggregate-version": String(message.aggregateVersion),
        ...(options.bearerToken ? {authorization: `Bearer ${options.bearerToken}`} : {}),
      },
      body: JSON.stringify(message.event),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`event publisher returned HTTP ${response.status}`);
  };
}
