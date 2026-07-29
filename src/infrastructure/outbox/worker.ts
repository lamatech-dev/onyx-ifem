import type { DispatchResult } from "./dispatcher.ts";

export interface BatchDispatcher {
  runOnce(): Promise<DispatchResult>;
}

export interface OutboxWorkerOptions {
  dispatcher: BatchDispatcher;
  pollIntervalMs?: number;
  errorDelayMs?: number;
  onBatch?: (result: DispatchResult) => void;
  onError?: (error: unknown) => void;
}

export class OutboxWorker {
  readonly #dispatcher: BatchDispatcher;
  readonly #pollIntervalMs: number;
  readonly #errorDelayMs: number;
  readonly #onBatch: (result: DispatchResult) => void;
  readonly #onError: (error: unknown) => void;
  #running = false;
  #stopping = false;
  #loop: Promise<void> | undefined;
  #wake: (() => void) | undefined;

  constructor(options: OutboxWorkerOptions) {
    this.#dispatcher = options.dispatcher;
    this.#pollIntervalMs = positiveInteger(options.pollIntervalMs ?? 1_000, "pollIntervalMs", 60_000);
    this.#errorDelayMs = positiveInteger(options.errorDelayMs ?? 5_000, "errorDelayMs", 300_000);
    this.#onBatch = options.onBatch ?? (() => undefined);
    this.#onError = options.onError ?? (() => undefined);
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running) throw new Error("outbox worker is already running");
    this.#running = true;
    this.#stopping = false;
    this.#loop = this.#run();
  }

  async stop(): Promise<void> {
    if (!this.#running) return;
    this.#stopping = true;
    this.#wake?.();
    await this.#loop;
  }

  async #run(): Promise<void> {
    try {
      while (!this.#stopping) {
        let delay = this.#pollIntervalMs;
        try {
          const result = await this.#dispatcher.runOnce();
          this.#notifyBatch(result);
          if (result.claimed > 0) delay = 0;
        } catch (error) {
          this.#notifyError(error);
          delay = this.#errorDelayMs;
        }
        if (!this.#stopping && delay > 0) await this.#wait(delay);
      }
    } finally {
      this.#wake = undefined;
      this.#loop = undefined;
      this.#running = false;
      this.#stopping = false;
    }
  }

  async #wait(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, delayMs);
      const worker = this;
      function finish(): void {
        clearTimeout(timer);
        if (worker.#wake === finish) worker.#wake = undefined;
        resolve();
      }
      this.#wake = finish;
    });
  }

  #notifyBatch(result: DispatchResult): void {
    try {
      this.#onBatch(result);
    } catch (error) {
      this.#notifyError(error);
    }
  }

  #notifyError(error: unknown): void {
    try {
      this.#onError(error);
    } catch {
      // Observability callbacks must not terminate delivery.
    }
  }
}

function positiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 through ${maximum}`);
  }
  return value;
}
