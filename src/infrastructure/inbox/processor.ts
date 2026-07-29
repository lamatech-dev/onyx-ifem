import { SqliteDatabase } from "../sqlite/database.ts";
import { sha256 } from "../../shared/canonical-json.ts";

export interface InboxEvent {
  event_id: string;
}

export interface InboxProcessorOptions<TEvent extends InboxEvent> {
  database: SqliteDatabase;
  consumerName: string;
  workerId: string;
  handle: (event: TEvent) => Promise<void>;
  now?: () => Date;
  leaseDurationMs?: number;
}

export type InboxProcessResult = "processed" | "duplicate" | "busy";

export class InboxProcessor<TEvent extends InboxEvent> {
  readonly #database: SqliteDatabase;
  readonly #consumerName: string;
  readonly #workerId: string;
  readonly #handle: (event: TEvent) => Promise<void>;
  readonly #now: () => Date;
  readonly #leaseDurationMs: number;

  constructor(options: InboxProcessorOptions<TEvent>) {
    if (!options.consumerName) throw new Error("inbox consumerName is required");
    if (!options.workerId) throw new Error("inbox workerId is required");
    const leaseDurationMs = options.leaseDurationMs ?? 30_000;
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1) {
      throw new Error("inbox leaseDurationMs must be a positive integer");
    }
    this.#database = options.database;
    this.#consumerName = options.consumerName;
    this.#workerId = options.workerId;
    this.#handle = options.handle;
    this.#now = options.now ?? (() => new Date());
    this.#leaseDurationMs = leaseDurationMs;
  }

  async process(event: TEvent): Promise<InboxProcessResult> {
    if (!event.event_id) throw new Error("inbox event_id is required");
    const claim = this.#database.claimInbox({
      consumerName: this.#consumerName,
      eventId: event.event_id,
      fingerprint: sha256(event),
      workerId: this.#workerId,
      now: this.#now(),
      leaseDurationMs: this.#leaseDurationMs,
    });
    if (claim.status !== "acquired") return claim.status;
    try {
      await this.#handle(event);
      this.#database.completeInbox(this.#consumerName, event.event_id, this.#workerId, this.#now());
      return "processed";
    } catch (error) {
      this.#database.releaseInbox(this.#consumerName, event.event_id, this.#workerId, errorMessage(error));
      throw error;
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
