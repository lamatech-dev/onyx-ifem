import type { Timeline, TimelineEvent, TimelineView } from "./types.ts";

export interface TimelineOperationRecord {
  fingerprint: string;
  event: TimelineEvent;
}

export interface TimelineRepository {
  find(timelineId: string): Promise<Timeline | undefined>;
  list(organizationId: string, afterId: string | undefined, limit: number): Promise<Timeline[]>;
  history(timelineId: string, afterVersion?: number, limit?: number): Promise<TimelineEvent[]>;
  findOperation(operationId: string): Promise<TimelineOperationRecord | undefined>;
  commit(timeline: Timeline, event: TimelineEvent, operationId: string, record: TimelineOperationRecord, create: boolean): Promise<void>;
}

export class InMemoryTimelineRepository implements TimelineRepository {
  readonly #timelines = new Map<string, Timeline>();
  readonly #events = new Map<string, TimelineEvent[]>();
  readonly #operations = new Map<string, TimelineOperationRecord>();

  async find(timelineId: string): Promise<Timeline | undefined> {
    const timeline = this.#timelines.get(timelineId);
    return timeline && structuredClone(timeline);
  }

  async list(organizationId: string, afterId: string | undefined, limit: number): Promise<Timeline[]> {
    return [...this.#timelines.values()]
      .filter((timeline) => timeline.organizationId === organizationId && (afterId === undefined || timeline.timelineId > afterId))
      .sort((left, right) => left.timelineId.localeCompare(right.timelineId))
      .slice(0, limit)
      .map((timeline) => structuredClone(timeline));
  }

  async history(timelineId: string, afterVersion = 0, limit = 100): Promise<TimelineEvent[]> {
    return (this.#events.get(timelineId) ?? [])
      .filter((event) => event.aggregate_version > afterVersion)
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  async findOperation(operationId: string): Promise<TimelineOperationRecord | undefined> {
    const record = this.#operations.get(operationId);
    return record && structuredClone(record);
  }

  async commit(timeline: Timeline, event: TimelineEvent, operationId: string, record: TimelineOperationRecord, create: boolean): Promise<void> {
    if (create === this.#timelines.has(timeline.timelineId)) throw new Error(create ? "timeline already exists during commit" : "timeline does not exist during commit");
    if (this.#operations.has(operationId)) throw new Error("operation already exists during commit");
    this.#timelines.set(timeline.timelineId, structuredClone(timeline));
    this.#events.set(timeline.timelineId, [...(this.#events.get(timeline.timelineId) ?? []), structuredClone(event)]);
    this.#operations.set(operationId, structuredClone(record));
  }
}

export function toTimelineView(timeline: Timeline): TimelineView {
  timeline.status ??= "ACTIVE";
  timeline.lifecycleEpoch ??= 0;
  timeline.authorityEpoch ??= 0;
  timeline.deadlines ??= {};
  timeline.milestones ??= {};
  timeline.criticalMarkers ??= {};
  timeline.penaltyZones ??= {};
  timeline.resolvedExceptionIds ??= [];
  return {
    timeline_id: timeline.timelineId,
    organization_id: timeline.organizationId,
    subject_ref: structuredClone(timeline.subjectRef),
    timezone: timeline.timezone,
    version: timeline.version,
    status: timeline.status,
    lifecycle_epoch: timeline.lifecycleEpoch,
    authority_epoch: timeline.authorityEpoch,
    deadlines: Object.fromEntries(Object.entries(timeline.deadlines).map(([id, value]) => [id, {deadline_at: value.deadlineAt, label: value.label}])),
    milestones: Object.fromEntries(Object.entries(timeline.milestones).map(([id, value]) => [id, {title: value.title, due_at: value.dueAt}])),
    critical_markers: Object.fromEntries(Object.entries(timeline.criticalMarkers).map(([id, value]) => [id, {label: value.label, trigger_at: value.triggerAt}])),
    penalty_zones: Object.fromEntries(Object.entries(timeline.penaltyZones).map(([id, value]) => [id, {starts_at: value.startsAt, reason: value.reason}])),
    resolved_exception_ids: structuredClone(timeline.resolvedExceptionIds),
  };
}
