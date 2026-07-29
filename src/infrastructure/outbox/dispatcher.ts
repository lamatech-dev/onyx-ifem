import { SqliteDatabase, type OutboxMessage } from "../sqlite/database.ts";

export interface OutboxDispatcherOptions<TEvent = unknown> {
  database: SqliteDatabase;
  workerId: string;
  publish: (message: OutboxMessage<TEvent>) => Promise<void>;
  now?: () => Date;
  batchSize?: number;
  leaseDurationMs?: number;
  maxAttempts?: number;
  retryDelayMs?: (attemptCount: number) => number;
}

export interface DispatchResult {
  claimed: number;
  delivered: number;
  retried: number;
  deadLettered: number;
}

export class OutboxDispatcher<TEvent = unknown> {
  readonly #database: SqliteDatabase;
  readonly #workerId: string;
  readonly #publish: (message: OutboxMessage<TEvent>) => Promise<void>;
  readonly #now: () => Date;
  readonly #batchSize: number;
  readonly #leaseDurationMs: number;
  readonly #maxAttempts: number;
  readonly #retryDelayMs: (attemptCount: number) => number;

  constructor(options: OutboxDispatcherOptions<TEvent>) {
    if (!options.workerId) throw new Error("outbox workerId is required");
    this.#database = options.database;
    this.#workerId = options.workerId;
    this.#publish = options.publish;
    this.#now = options.now ?? (() => new Date());
    this.#batchSize = positiveInteger(options.batchSize ?? 10, "batchSize", 1_000);
    this.#leaseDurationMs = positiveInteger(options.leaseDurationMs ?? 120_000, "leaseDurationMs");
    this.#maxAttempts = positiveInteger(options.maxAttempts ?? 10, "maxAttempts");
    this.#retryDelayMs = options.retryDelayMs ?? ((attempt) => Math.min(60_000, 1_000 * 2 ** (attempt - 1)));
  }

  async runOnce(): Promise<DispatchResult> {
    const messages = this.#database.claimOutbox<TEvent>({
      workerId: this.#workerId,
      now: this.#now(),
      leaseDurationMs: this.#leaseDurationMs,
      limit: this.#batchSize,
    });
    const result: DispatchResult = {claimed: messages.length, delivered: 0, retried: 0, deadLettered: 0};
    for (const message of messages) {
      try {
        await this.#publish(message);
        this.#database.acknowledgeOutbox(message.eventId, this.#workerId, this.#now());
        result.delivered += 1;
      } catch (error) {
        const delay = positiveInteger(this.#retryDelayMs(message.attemptCount), "retry delay");
        const failedAt = this.#now();
        const retryAt = new Date(failedAt.getTime() + delay);
        const disposition = this.#database.rejectOutbox(
          message.eventId,
          this.#workerId,
          errorMessage(error),
          failedAt,
          retryAt,
          this.#maxAttempts,
        );
        if (disposition === "retry") result.retried += 1;
        else result.deadLettered += 1;
      }
    }
    return result;
  }
}

function positiveInteger(value: number, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be a positive integer`);
  return value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
