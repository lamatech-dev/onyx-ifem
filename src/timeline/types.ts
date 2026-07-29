import type { CommandEnvelope, DomainObjectRef, EventEnvelope, UuidV7 } from "../contracts/envelopes.ts";

export interface CreateTimelinePayload {
  timeline_id: UuidV7;
  subject_ref: DomainObjectRef;
  timezone: string;
}

export type CreateTimelineCommand = CommandEnvelope<"CreateTimeline", CreateTimelinePayload>;
export type TimelineCreatedEvent = EventEnvelope<"TimelineCreated", CreateTimelinePayload>;

export interface Timeline {
  timelineId: UuidV7;
  organizationId: UuidV7;
  subjectRef: DomainObjectRef;
  timezone: string;
  version: number;
}

export interface TimelineView {
  timeline_id: UuidV7;
  organization_id: UuidV7;
  subject_ref: DomainObjectRef;
  timezone: string;
  version: number;
}
