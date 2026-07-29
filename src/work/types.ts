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
}

