import type { CommandEnvelope, DomainObjectRef, EventEnvelope, UuidV7 } from "../contracts/envelopes.ts";

export interface CreateTimelinePayload {
  timeline_id: UuidV7;
  subject_ref: DomainObjectRef;
  timezone: string;
}

export type CreateTimelineCommand = CommandEnvelope<"CreateTimeline", CreateTimelinePayload>;
export type TimelineCreatedEvent = EventEnvelope<"TimelineCreated", CreateTimelinePayload>;

export interface SetDeadlinePayload { timeline_id: UuidV7; deadline_id: UuidV7; deadline_at: string; label: string }
export interface MoveDeadlinePayload { timeline_id: UuidV7; deadline_id: UuidV7; new_deadline_at: string; reason: string }
export interface AddMilestonePayload { timeline_id: UuidV7; milestone_id: UuidV7; title: string; due_at: string }
export interface DefineCriticalMarkerPayload { timeline_id: UuidV7; marker_id: UuidV7; label: string; trigger_at: string }
export interface ActivatePenaltyZonePayload { timeline_id: UuidV7; penalty_zone_id: UuidV7; starts_at: string; reason: string }
export interface ResolveScheduleExceptionPayload { timeline_id: UuidV7; exception_id: UuidV7; resolution_note: string }
export interface ArchiveTimelinePayload { timeline_id: UuidV7; retention_policy_id: UuidV7 }

export type TimelineCommand = CreateTimelineCommand |
  CommandEnvelope<"SetDeadline", SetDeadlinePayload> | CommandEnvelope<"MoveDeadline", MoveDeadlinePayload> |
  CommandEnvelope<"AddMilestone", AddMilestonePayload> | CommandEnvelope<"DefineCriticalMarker", DefineCriticalMarkerPayload> |
  CommandEnvelope<"ActivatePenaltyZone", ActivatePenaltyZonePayload> | CommandEnvelope<"ResolveScheduleException", ResolveScheduleExceptionPayload> |
  CommandEnvelope<"ArchiveTimeline", ArchiveTimelinePayload>;

export type TimelineEvent = TimelineCreatedEvent |
  EventEnvelope<"DeadlineChanged", {deadline_id: UuidV7; deadline_at: string; label: string}> |
  EventEnvelope<"DeadlineMoved", {deadline_id: UuidV7; deadline_at: string}> |
  EventEnvelope<"MilestoneAdded", {milestone_id: UuidV7; title: string; due_at: string}> |
  EventEnvelope<"CriticalMarkerDefined", {marker_id: UuidV7; label: string; trigger_at: string}> |
  EventEnvelope<"DeadlineReached", {timeline_id: UuidV7; deadline_id: UuidV7; reached_at: string}> |
  EventEnvelope<"CriticalMarkerReached", {timeline_id: UuidV7; marker_id: UuidV7; reached_at: string}> |
  EventEnvelope<"PenaltyZoneActivated", {penalty_zone_id: UuidV7; starts_at: string}> |
  EventEnvelope<"ScheduleExceptionRaised", {exception_id: UuidV7; resolution_status: "RESOLVED"}> |
  EventEnvelope<"TimelineArchived", {new_status: "ARCHIVED"}>;

export interface Timeline {
  timelineId: UuidV7;
  organizationId: UuidV7;
  subjectRef: DomainObjectRef;
  timezone: string;
  version: number;
  status: "ACTIVE" | "ARCHIVED";
  lifecycleEpoch: number;
  authorityEpoch: number;
  deadlines: Record<UuidV7, {deadlineAt: string; label: string}>;
  milestones: Record<UuidV7, {title: string; dueAt: string}>;
  criticalMarkers: Record<UuidV7, {label: string; triggerAt: string}>;
  penaltyZones: Record<UuidV7, {startsAt: string; reason: string}>;
  resolvedExceptionIds: UuidV7[];
  reachedDeadlineIds: UuidV7[];
  reachedMarkerIds: UuidV7[];
}

export interface TimelineView {
  timeline_id: UuidV7;
  organization_id: UuidV7;
  subject_ref: DomainObjectRef;
  timezone: string;
  version: number;
  status: "ACTIVE" | "ARCHIVED";
  lifecycle_epoch: number;
  authority_epoch: number;
  deadlines: Record<UuidV7, {deadline_at: string; label: string}>;
  milestones: Record<UuidV7, {title: string; due_at: string}>;
  critical_markers: Record<UuidV7, {label: string; trigger_at: string}>;
  penalty_zones: Record<UuidV7, {starts_at: string; reason: string}>;
  resolved_exception_ids: UuidV7[];
  reached_deadline_ids: UuidV7[];
  reached_marker_ids: UuidV7[];
}
