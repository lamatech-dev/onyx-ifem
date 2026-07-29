import { OnyxError } from "../contracts/errors.ts";
import { assertEmittedEvent } from "../contracts/validation.ts";
import { sha256 } from "../shared/canonical-json.ts";
import { utcInstant, uuidV7 } from "../shared/identifiers.ts";
import { toTaskView, type WorkRepository } from "./repository.ts";
import type { CreateTaskCommand, Task, TaskCreatedEvent, TaskView } from "./types.ts";
import { validateCreateTaskCommand } from "./validation.ts";

export interface WorkServiceOptions {
  repository: WorkRepository;
  requireMission: (organizationId: string, missionId: string) => Promise<void>;
  now?: () => Date;
  replicaId?: string;
}

export class WorkService {
  readonly #repository: WorkRepository;
  readonly #requireMission: WorkServiceOptions["requireMission"];
  readonly #now: () => Date;
  readonly #replicaId: string;

  constructor(options: WorkServiceOptions) {
    this.#repository = options.repository;
    this.#requireMission = options.requireMission;
    this.#now = options.now ?? (() => new Date());
    this.#replicaId = options.replicaId ?? "work-service";
  }

  async execute(input: unknown): Promise<TaskCreatedEvent> {
    if ((input as {command_type?: string})?.command_type !== "CreateTask") {
      throw new OnyxError("INVALID_ARGUMENT", "command is not implemented because its payload is not frozen");
    }
    return this.createTask(input);
  }

  async createTask(input: unknown): Promise<TaskCreatedEvent> {
    validateCreateTaskCommand(input);
    const command = input;
    const fingerprint = sha256(command);
    const prior = await this.#repository.findOperation(command.operation_id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new OnyxError("IDEMPOTENCY_KEY_REUSE", "operation_id was reused with a different command");
      return prior.event;
    }
    if (!command.authority_proof.scope.includes("work:create") || Date.parse(command.authority_proof.expires_at) <= this.#now().getTime()) {
      throw new OnyxError("AUTHORITY_PROOF_INVALID", "work:create authority is missing or expired");
    }
    if (command.expected_version !== undefined && command.expected_version !== 0) {
      throw new OnyxError("VERSION_CONFLICT", "a new task must expect version 0");
    }
    if (await this.#repository.find(command.payload.task_id)) throw new OnyxError("VERSION_CONFLICT", "task already exists");
    await this.#requireMission(command.organization_id, command.payload.mission_id);

    const task: Task = {
      taskId: command.payload.task_id,
      organizationId: command.organization_id,
      missionId: command.payload.mission_id,
      title: command.payload.title,
      description: command.payload.description,
      ownerId: command.payload.owner_id,
      priority: command.payload.priority,
      ...(command.payload.due_date_ref !== undefined ? {dueDateRef: structuredClone(command.payload.due_date_ref)} : {}),
      ...(command.payload.estimate !== undefined ? {estimate: structuredClone(command.payload.estimate)} : {}),
      status: "DRAFT",
      version: 1,
    };
    const now = this.#now();
    const occurredAt = utcInstant(now);
    const eventWithoutDigest = {
      event_id: uuidV7(now),
      event_type: "TaskCreated" as const,
      schema_version: 1 as const,
      organization_id: command.organization_id,
      aggregate: {aggregate_type: "Task", object_id: command.payload.task_id},
      aggregate_version: 1,
      lifecycle_epoch: 0,
      authority_epoch: command.authority_proof.authority_epoch,
      operation_id: command.operation_id,
      actor_context: command.actor_context,
      occurred_at: occurredAt,
      recorded_at: occurredAt,
      vector_clock: {
        ...command.vector_clock,
        [this.#replicaId]: (command.vector_clock[this.#replicaId] ?? 0) + 1,
      },
      correlation_id: command.correlation_id,
      causation_id: command.command_id,
      payload: structuredClone(command.payload),
    };
    const event: TaskCreatedEvent = {
      ...eventWithoutDigest,
      audit: {provenance: "CreateTask@1", integrity_digest: sha256(eventWithoutDigest)},
    };
    assertEmittedEvent(event, "TaskCreated", "Task");
    await this.#repository.commit(task, event, command.operation_id, {fingerprint, event});
    return structuredClone(event);
  }

  async getTask(organizationId: string, taskId: string): Promise<TaskView> {
    const task = await this.#repository.find(taskId);
    if (!task || task.organizationId !== organizationId) throw new OnyxError("NOT_FOUND", "task not found");
    return toTaskView(task);
  }

  async listTasks(organizationId: string): Promise<TaskView[]> {
    return (await this.#repository.list(organizationId)).map(toTaskView);
  }

  async getHistory(organizationId: string, taskId: string, afterVersion = 0, limit = 100): Promise<TaskCreatedEvent[]> {
    await this.getTask(organizationId, taskId);
    if (!Number.isInteger(afterVersion) || afterVersion < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new OnyxError("INVALID_ARGUMENT", "history bounds are invalid");
    }
    return this.#repository.history(taskId, afterVersion, limit);
  }
}
