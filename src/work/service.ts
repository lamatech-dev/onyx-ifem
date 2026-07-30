import { OnyxError } from "../contracts/errors.ts";
import type { VectorClock } from "../contracts/envelopes.ts";
import { assertEmittedEvent } from "../contracts/validation.ts";
import { sha256 } from "../shared/canonical-json.ts";
import { utcInstant, uuidV7 } from "../shared/identifiers.ts";
import { toTaskView, type WorkRepository } from "./repository.ts";
import type { CreateTaskCommand, Task, TaskStatus, TaskView, WorkCommand, WorkEvent } from "./types.ts";
import { validateWorkCommand } from "./validation.ts";

export interface WorkServiceOptions {
  repository: WorkRepository;
  requireMission: (organizationId: string, missionId: string) => Promise<void>;
  now?: () => Date;
  replicaId?: string;
}

type MutationCommand = Exclude<WorkCommand, CreateTaskCommand>;

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

  async execute(input: unknown): Promise<WorkEvent> {
    validateWorkCommand(input);
    const command = input;
    const replay = await this.#replay(command);
    if (replay) return replay;
    switch (command.command_type) {
      case "CreateTask": return this.#createTask(command);
      case "AssignOwner": return this.#mutate(command, "work:owner:assign", ["DRAFT", "READY", "ACTIVE", "PAUSED", "BLOCKED"], "TaskOwnerAssigned", (task) => { task.ownerId = command.payload.owner_id; return {owner_id: command.payload.owner_id}; });
      case "ChangePriority": return this.#mutate(command, "work:priority:change", ["DRAFT", "READY", "ACTIVE", "PAUSED", "BLOCKED", "SUBMITTED"], "TaskPriorityChanged", (task) => { task.priority = command.payload.priority; return {priority: command.payload.priority}; });
      case "AddDependency": {
        if (command.payload.task_id === command.payload.dependency_task_id) throw new OnyxError("INVALID_ARGUMENT", "a task cannot depend on itself");
        const dependency = await this.#repository.find(command.payload.dependency_task_id);
        if (!dependency || dependency.organizationId !== command.organization_id) throw new OnyxError("NOT_FOUND", "dependency task not found");
        return this.#mutate(command, "work:dependency:add", ["DRAFT", "READY"], "TaskDependencyAdded", (task) => {
          if (task.missionId !== dependency.missionId) throw new OnyxError("ORGANIZATION_MISMATCH", "dependency must belong to the same mission");
          if (task.dependencyTaskIds.includes(dependency.taskId)) throw new OnyxError("VERSION_CONFLICT", "dependency already exists");
          task.dependencyTaskIds.push(dependency.taskId);
          return {dependency_task_id: dependency.taskId};
        });
      }
      case "StartTask": return this.#transition(command, "work:start", ["DRAFT", "READY", "PAUSED", "BLOCKED"], "ACTIVE", "TaskStarted");
      case "PauseTask": return this.#transition(command, "work:pause", ["ACTIVE"], "PAUSED", "TaskPaused");
      case "BlockTask": return this.#transition(command, "work:block", ["READY", "ACTIVE", "PAUSED"], "BLOCKED", "TaskBlocked");
      case "SubmitCompletion": return this.#transition(command, "work:completion:submit", ["ACTIVE"], "SUBMITTED", "TaskCompletionSubmitted");
      case "ApproveTask": return this.#transition(command, "work:approve", ["SUBMITTED"], "APPROVED", "TaskApproved");
      case "ReopenTask": return this.#transition(command, "work:reopen", ["SUBMITTED", "APPROVED", "CLOSED"], "ACTIVE", "TaskReopened", true);
      case "CloseTask": return this.#transition(command, "work:close", ["APPROVED"], "CLOSED", "TaskClosed", true);
      case "CancelTask": return this.#transition(command, "work:cancel", ["DRAFT", "READY", "ACTIVE", "PAUSED", "BLOCKED", "SUBMITTED", "APPROVED"], "CANCELLED", "TaskCancelled", true);
    }
  }

  async createTask(input: unknown): Promise<WorkEvent> {
    validateWorkCommand(input);
    if (input.command_type !== "CreateTask") throw new OnyxError("INVALID_ARGUMENT", "CreateTask is required");
    const replay = await this.#replay(input);
    return replay ?? this.#createTask(input);
  }

  async #createTask(command: CreateTaskCommand): Promise<WorkEvent> {
    this.#authorize(command, "work:create");
    if (command.expected_version !== undefined && command.expected_version !== 0) throw new OnyxError("VERSION_CONFLICT", "a new task must expect version 0");
    if (await this.#repository.find(command.payload.task_id)) throw new OnyxError("VERSION_CONFLICT", "task already exists");
    await this.#requireMission(command.organization_id, command.payload.mission_id);
    const task: Task = {
      taskId: command.payload.task_id, organizationId: command.organization_id, missionId: command.payload.mission_id,
      title: command.payload.title, description: command.payload.description, ownerId: command.payload.owner_id,
      priority: command.payload.priority,
      ...(command.payload.due_date_ref !== undefined ? {dueDateRef: structuredClone(command.payload.due_date_ref)} : {}),
      ...(command.payload.estimate !== undefined ? {estimate: structuredClone(command.payload.estimate)} : {}),
      status: "DRAFT", version: 1, lifecycleEpoch: 0, authorityEpoch: command.authority_proof.authority_epoch,
      dependencyTaskIds: [],
    };
    return this.#publish(command, task, "TaskCreated", structuredClone(command.payload), true);
  }

  async #transition(command: MutationCommand, scope: string, allowed: TaskStatus[], status: TaskStatus, eventType: WorkEvent["event_type"], incrementEpoch = false): Promise<WorkEvent> {
    return this.#mutate(command, scope, allowed, eventType, (task) => {
      task.status = status;
      if (incrementEpoch) task.lifecycleEpoch += 1;
      return {new_status: status};
    });
  }

  async #mutate(command: MutationCommand, scope: string, allowed: TaskStatus[], eventType: WorkEvent["event_type"], change: (task: Task) => unknown): Promise<WorkEvent> {
    const task = await this.#load(command, scope, allowed);
    const payload = change(task);
    task.version += 1;
    return this.#publish(command, task, eventType, payload, false);
  }

  async #load(command: MutationCommand, scope: string, allowed: TaskStatus[]): Promise<Task> {
    this.#authorize(command, scope);
    const task = await this.#repository.find(command.payload.task_id);
    if (!task || task.organizationId !== command.organization_id) throw new OnyxError("NOT_FOUND", "task not found");
    task.lifecycleEpoch ??= 0;
    task.authorityEpoch ??= command.authority_proof.authority_epoch;
    task.dependencyTaskIds ??= [];
    if (command.expected_version !== undefined && command.expected_version !== task.version) throw new OnyxError("VERSION_CONFLICT", "expected_version does not match");
    if (command.expected_lifecycle_epoch !== undefined && command.expected_lifecycle_epoch !== task.lifecycleEpoch) throw new OnyxError("LIFECYCLE_EPOCH_MISMATCH", "expected_lifecycle_epoch does not match");
    if (command.expected_authority_epoch !== undefined && command.expected_authority_epoch !== task.authorityEpoch) throw new OnyxError("AUTHORITY_EPOCH_MISMATCH", "expected_authority_epoch does not match");
    if (!allowed.includes(task.status)) throw new OnyxError("INVALID_STATE_TRANSITION", `${command.command_type} is not valid from ${task.status}`);
    return task;
  }

  #authorize(command: WorkCommand, scope: string): void {
    if (!command.authority_proof.scope.includes(scope) || Date.parse(command.authority_proof.expires_at) <= this.#now().getTime()) throw new OnyxError("AUTHORITY_PROOF_INVALID", `${scope} authority is missing or expired`);
  }

  async #replay(command: WorkCommand): Promise<WorkEvent | undefined> {
    const prior = await this.#repository.findOperation(command.operation_id);
    if (!prior) return undefined;
    if (prior.fingerprint !== sha256(command)) throw new OnyxError("IDEMPOTENCY_KEY_REUSE", "operation_id was reused with a different command");
    return prior.event;
  }

  async #publish(command: WorkCommand, task: Task, eventType: WorkEvent["event_type"], payload: unknown, create: boolean): Promise<WorkEvent> {
    const now = this.#now();
    const occurredAt = utcInstant(now);
    const eventWithoutDigest = {
      event_id: uuidV7(now), event_type: eventType, schema_version: 1 as const,
      organization_id: command.organization_id, aggregate: {aggregate_type: "Task", object_id: task.taskId},
      aggregate_version: task.version, lifecycle_epoch: task.lifecycleEpoch, authority_epoch: task.authorityEpoch,
      operation_id: command.operation_id, actor_context: command.actor_context, occurred_at: occurredAt, recorded_at: occurredAt,
      vector_clock: this.#advanceClock(command.vector_clock), correlation_id: command.correlation_id, causation_id: command.command_id, payload,
    };
    const event = {...eventWithoutDigest, audit: {provenance: `${command.command_type}@1`, integrity_digest: sha256(eventWithoutDigest)}} as WorkEvent;
    assertEmittedEvent(event, eventType, "Task");
    await this.#repository.commit(task, event, command.operation_id, {fingerprint: sha256(command), event}, create);
    return structuredClone(event);
  }

  #advanceClock(clock: VectorClock): VectorClock { return {...clock, [this.#replicaId]: (clock[this.#replicaId] ?? 0) + 1}; }

  async getTask(organizationId: string, taskId: string): Promise<TaskView> {
    const task = await this.#repository.find(taskId);
    if (!task || task.organizationId !== organizationId) throw new OnyxError("NOT_FOUND", "task not found");
    task.lifecycleEpoch ??= 0; task.authorityEpoch ??= 0; task.dependencyTaskIds ??= [];
    return toTaskView(task);
  }
  async listTasks(organizationId: string, afterId?: string, limit = 100): Promise<TaskView[]> { return (await this.#repository.list(organizationId, afterId, limit)).map((task) => { task.lifecycleEpoch ??= 0; task.authorityEpoch ??= 0; task.dependencyTaskIds ??= []; return toTaskView(task); }); }
  async getHistory(organizationId: string, taskId: string, afterVersion = 0, limit = 100): Promise<WorkEvent[]> {
    await this.getTask(organizationId, taskId);
    if (!Number.isInteger(afterVersion) || afterVersion < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new OnyxError("INVALID_ARGUMENT", "history bounds are invalid");
    return this.#repository.history(taskId, afterVersion, limit);
  }
}
