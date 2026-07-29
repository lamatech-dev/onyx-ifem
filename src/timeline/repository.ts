import type { Timeline, TimelineCreatedEvent, TimelineView } from "./types.ts";

export interface TimelineOperationRecord {
  fingerprint: string;
  event: TimelineCreatedEvent;
}

export interface TimelineRepository {
  find(timelineId: string): Promise<Timeline | undefined>;
  list(organizationId: string): Promise<Timeline[]>;
  history(timelineId: string, afterVersion?: number, limit?: number): Promise<TimelineCreatedEvent[]>;
  findOperation(operationId: string): Promise<TimelineOperationRecord | undefined>;
  commit(timeline: Timeline, event: TimelineCreatedEvent, operationId: string, record: TimelineOperationRecord): Promise<void>;
}

export class InMemoryTimelineRepository implements TimelineRepository {
  readonly #timelines = new Map<string, Timeline>();
  readonly #events = new Map<string, TimelineCreatedEvent[]>();
  readonly #operations = new Map<string, TimelineOperationRecord>();

  async find(timelineId: string): Promise<Timeline | undefined> {
    const timeline = this.#timelines.get(timelineId);
    return timeline && structuredClone(timeline);
  }

  async list(organizationId: string): Promise<Timeline[]> {
    return [...this.#timelines.values()]
      .filter((timeline) => timeline.organizationId === organizationId)
      .sort((left, right) => left.timelineId.localeCompare(right.timelineId))
      .map((timeline) => structuredClone(timeline));
  }

  async history(timelineId: string, afterVersion = 0, limit = 100): Promise<TimelineCreatedEvent[]> {
    return (this.#events.get(timelineId) ?? [])
      .filter((event) => event.aggregate_version > afterVersion)
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  async findOperation(operationId: string): Promise<TimelineOperationRecord | undefined> {
    const record = this.#operations.get(operationId);
    return record && structuredClone(record);
  }

  async commit(timeline: Timeline, event: TimelineCreatedEvent, operationId: string, record: TimelineOperationRecord): Promise<void> {
    if (this.#timelines.has(timeline.timelineId)) throw new Error("timeline already exists during commit");
    if (this.#operations.has(operationId)) throw new Error("operation already exists during commit");
    this.#timelines.set(timeline.timelineId, structuredClone(timeline));
    this.#events.set(timeline.timelineId, [structuredClone(event)]);
    this.#operations.set(operationId, structuredClone(record));
  }
}

export function toTimelineView(timeline: Timeline): TimelineView {
  return {
    timeline_id: timeline.timelineId,
    organization_id: timeline.organizationId,
    subject_ref: structuredClone(timeline.subjectRef),
    timezone: timeline.timezone,
    version: timeline.version,
  };
}
