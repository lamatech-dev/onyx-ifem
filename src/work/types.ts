import type { CommandEnvelope, EventEnvelope, UuidV7 } from "../contracts/envelopes.ts";

export interface CreateTaskPayload {
  task_id: UuidV7;
  mission_id: UuidV7;
  title: string;
  description: string;
  owner_id: UuidV7;
  priority: string;
  due_date_ref?: Record<string, unknown>;
  estimate?: Record<string, unknown>;
}

export type CreateTaskCommand = CommandEnvelope<"CreateTask", CreateTaskPayload>;
export type TaskCreatedEvent = EventEnvelope<"TaskCreated", CreateTaskPayload>;

export interface AssignOwnerPayload { task_id: UuidV7; owner_id: UuidV7; assignment_note?: string }
export interface ChangePriorityPayload { task_id: UuidV7; priority: string; reason?: string }
export interface AddDependencyPayload { task_id: UuidV7; dependency_task_id: UuidV7 }
export interface StartTaskPayload { task_id: UuidV7; start_note?: string }
export interface PauseTaskPayload { task_id: UuidV7; reason_code: string; reason: string }
export interface BlockTaskPayload { task_id: UuidV7; blocker_code: string; blocker_description: string }
export interface SubmitCompletionPayload { task_id: UuidV7; completion_summary: string; evidence_refs?: UuidV7[] }
export interface ApproveTaskPayload { task_id: UuidV7; approval_note: string }
export interface ReopenTaskPayload { task_id: UuidV7; reason: string }
export interface CloseTaskPayload { task_id: UuidV7; closure_note: string }
export interface CancelTaskPayload { task_id: UuidV7; reason_code: string; reason: string }

export type AssignOwnerCommand = CommandEnvelope<"AssignOwner", AssignOwnerPayload>;
export type ChangePriorityCommand = CommandEnvelope<"ChangePriority", ChangePriorityPayload>;
export type AddDependencyCommand = CommandEnvelope<"AddDependency", AddDependencyPayload>;
export type StartTaskCommand = CommandEnvelope<"StartTask", StartTaskPayload>;
export type PauseTaskCommand = CommandEnvelope<"PauseTask", PauseTaskPayload>;
export type BlockTaskCommand = CommandEnvelope<"BlockTask", BlockTaskPayload>;
export type SubmitCompletionCommand = CommandEnvelope<"SubmitCompletion", SubmitCompletionPayload>;
export type ApproveTaskCommand = CommandEnvelope<"ApproveTask", ApproveTaskPayload>;
export type ReopenTaskCommand = CommandEnvelope<"ReopenTask", ReopenTaskPayload>;
export type CloseTaskCommand = CommandEnvelope<"CloseTask", CloseTaskPayload>;
export type CancelTaskCommand = CommandEnvelope<"CancelTask", CancelTaskPayload>;

export type WorkCommand = CreateTaskCommand | AssignOwnerCommand | ChangePriorityCommand | AddDependencyCommand |
  StartTaskCommand | PauseTaskCommand | BlockTaskCommand | SubmitCompletionCommand | ApproveTaskCommand |
  ReopenTaskCommand | CloseTaskCommand | CancelTaskCommand;

export type WorkEvent = TaskCreatedEvent |
  EventEnvelope<"TaskOwnerAssigned", {owner_id: UuidV7}> |
  EventEnvelope<"TaskPriorityChanged", {priority: string}> |
  EventEnvelope<"TaskDependencyAdded", {dependency_task_id: UuidV7}> |
  EventEnvelope<"TaskStarted", {new_status: "ACTIVE"}> |
  EventEnvelope<"TaskPaused", {new_status: "PAUSED"}> |
  EventEnvelope<"TaskBlocked", {new_status: "BLOCKED"}> |
  EventEnvelope<"TaskCompletionSubmitted", {new_status: "SUBMITTED"}> |
  EventEnvelope<"TaskApproved", {new_status: "APPROVED"}> |
  EventEnvelope<"TaskReopened", {new_status: "ACTIVE"}> |
  EventEnvelope<"TaskClosed", {new_status: "CLOSED"}> |
  EventEnvelope<"TaskCancelled", {new_status: "CANCELLED"}>;

export type TaskStatus =
  | "DRAFT"
  | "READY"
  | "ACTIVE"
  | "PAUSED"
  | "BLOCKED"
  | "SUBMITTED"
  | "APPROVED"
  | "CLOSED"
  | "CANCELLED";

export interface Task {
  taskId: UuidV7;
  organizationId: UuidV7;
  missionId: UuidV7;
  title: string;
  description: string;
  ownerId: UuidV7;
  priority: string;
  dueDateRef?: Record<string, unknown>;
  estimate?: Record<string, unknown>;
  status: TaskStatus;
  version: number;
  lifecycleEpoch: number;
  authorityEpoch: number;
  dependencyTaskIds: UuidV7[];
}

export interface TaskView {
  task_id: UuidV7;
  organization_id: UuidV7;
  mission_id: UuidV7;
  title: string;
  description: string;
  owner_id: UuidV7;
  priority: string;
  status: TaskStatus;
  version: number;
  lifecycle_epoch: number;
  authority_epoch: number;
  dependency_task_ids: UuidV7[];
}
