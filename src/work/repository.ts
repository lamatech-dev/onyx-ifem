import type { Task, TaskCreatedEvent, TaskView } from "./types.ts";

export interface WorkOperationRecord {
  fingerprint: string;
  event: TaskCreatedEvent;
}

export interface WorkRepository {
  find(taskId: string): Promise<Task | undefined>;
  list(organizationId: string, afterId: string | undefined, limit: number): Promise<Task[]>;
  history(taskId: string, afterVersion?: number, limit?: number): Promise<TaskCreatedEvent[]>;
  findOperation(operationId: string): Promise<WorkOperationRecord | undefined>;
  commit(task: Task, event: TaskCreatedEvent, operationId: string, record: WorkOperationRecord): Promise<void>;
}

export class InMemoryWorkRepository implements WorkRepository {
  readonly #tasks = new Map<string, Task>();
  readonly #events = new Map<string, TaskCreatedEvent[]>();
  readonly #operations = new Map<string, WorkOperationRecord>();

  async find(taskId: string): Promise<Task | undefined> {
    const task = this.#tasks.get(taskId);
    return task && structuredClone(task);
  }

  async list(organizationId: string, afterId: string | undefined, limit: number): Promise<Task[]> {
    return [...this.#tasks.values()]
      .filter((task) => task.organizationId === organizationId && (afterId === undefined || task.taskId > afterId))
      .sort((left, right) => left.taskId.localeCompare(right.taskId))
      .slice(0, limit)
      .map((task) => structuredClone(task));
  }

  async history(taskId: string, afterVersion = 0, limit = 100): Promise<TaskCreatedEvent[]> {
    return (this.#events.get(taskId) ?? [])
      .filter((event) => event.aggregate_version > afterVersion)
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  async findOperation(operationId: string): Promise<WorkOperationRecord | undefined> {
    const record = this.#operations.get(operationId);
    return record && structuredClone(record);
  }

  async commit(task: Task, event: TaskCreatedEvent, operationId: string, record: WorkOperationRecord): Promise<void> {
    if (this.#tasks.has(task.taskId)) throw new Error("task already exists during commit");
    if (this.#operations.has(operationId)) throw new Error("operation already exists during commit");
    this.#tasks.set(task.taskId, structuredClone(task));
    this.#events.set(task.taskId, [structuredClone(event)]);
    this.#operations.set(operationId, structuredClone(record));
  }
}

export function toTaskView(task: Task): TaskView {
  return {
    task_id: task.taskId,
    organization_id: task.organizationId,
    mission_id: task.missionId,
    title: task.title,
    description: task.description,
    owner_id: task.ownerId,
    priority: task.priority,
    status: task.status,
    version: task.version,
  };
}
