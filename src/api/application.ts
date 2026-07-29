import { OnyxError } from "../contracts/errors.ts";
import { SqliteDatabase } from "../infrastructure/sqlite/database.ts";
import { InMemoryMissionRepository } from "../mission/repository.ts";
import { MissionService } from "../mission/service.ts";
import { SqliteMissionRepository } from "../mission/sqlite-repository.ts";
import { InMemoryReportingRepository } from "../reporting-evidence/repository.ts";
import { ReportingService } from "../reporting-evidence/service.ts";
import { SqliteReportingRepository } from "../reporting-evidence/sqlite-repository.ts";
import { InMemoryTimelineRepository } from "../timeline/repository.ts";
import { TimelineService } from "../timeline/service.ts";
import { SqliteTimelineRepository } from "../timeline/sqlite-repository.ts";
import { InMemoryWorkRepository } from "../work/repository.ts";
import { WorkService } from "../work/service.ts";
import { SqliteWorkRepository } from "../work/sqlite-repository.ts";

export interface ApiRequest {
  method: string;
  path: string;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface OnyxApplicationOptions {
  databasePath?: string;
  now?: () => Date;
  replicaIds?: Partial<Record<"mission" | "work" | "timeline" | "reportingEvidence", string>>;
  logError?: (error: unknown) => void;
}

interface ResourceRoutes {
  list: (organizationId: string) => Promise<unknown[]>;
  get: (organizationId: string, objectId: string) => Promise<unknown>;
  history: (organizationId: string, objectId: string, afterVersion: number, limit: number) => Promise<unknown[]>;
}

export class OnyxApplication {
  readonly #database: SqliteDatabase | undefined;
  readonly #commands: ReadonlyMap<string, (body: unknown) => Promise<unknown>>;
  readonly #resources: ReadonlyMap<string, ResourceRoutes>;
  readonly #logError: (error: unknown) => void;
  #closed = false;

  constructor(options: OnyxApplicationOptions = {}) {
    this.#database = options.databasePath ? new SqliteDatabase(options.databasePath) : undefined;
    this.#logError = options.logError ?? console.error;
    const time = options.now ? {now: options.now} : {};
    const mission = new MissionService({
      repository: this.#database ? new SqliteMissionRepository(this.#database) : new InMemoryMissionRepository(),
      ...time,
      replicaId: options.replicaIds?.mission ?? "mission-api",
    });
    const work = new WorkService({
      repository: this.#database ? new SqliteWorkRepository(this.#database) : new InMemoryWorkRepository(),
      ...time,
      replicaId: options.replicaIds?.work ?? "work-api",
      requireMission: async (organizationId, missionId) => {
        await mission.getMission(organizationId, missionId);
      },
    });
    const timeline = new TimelineService({
      repository: this.#database ? new SqliteTimelineRepository(this.#database) : new InMemoryTimelineRepository(),
      ...time,
      replicaId: options.replicaIds?.timeline ?? "timeline-api",
      requireSubject: async (organizationId, subject) => {
        if (subject.aggregate_type === "Mission") return void await mission.getMission(organizationId, subject.object_id);
        if (subject.aggregate_type === "Task") return void await work.getTask(organizationId, subject.object_id);
        throw new OnyxError("INVALID_ARGUMENT", `unsupported timeline subject type: ${subject.aggregate_type}`);
      },
    });
    const reporting = new ReportingService({
      repository: this.#database ? new SqliteReportingRepository(this.#database) : new InMemoryReportingRepository(),
      ...time,
      replicaId: options.replicaIds?.reportingEvidence ?? "reporting-evidence-api",
      requireSubject: async (organizationId, subject) => {
        if (subject.aggregate_type === "Mission") return void await mission.getMission(organizationId, subject.object_id);
        if (subject.aggregate_type === "Task") return void await work.getTask(organizationId, subject.object_id);
        if (subject.aggregate_type === "Timeline") return void await timeline.getTimeline(organizationId, subject.object_id);
        throw new OnyxError("INVALID_ARGUMENT", `unsupported report subject type: ${subject.aggregate_type}`);
      },
    });

    this.#commands = new Map<string, (body: unknown) => Promise<unknown>>([
      ["mission", (body) => mission.execute(body)],
      ["work", (body) => work.execute(body)],
      ["timeline", (body) => timeline.execute(body)],
      ["reporting-evidence", (body) => reporting.execute(body)],
    ]);
    this.#resources = new Map([
      ["missions", {
        list: (organizationId) => mission.listMissions(organizationId),
        get: (organizationId, objectId) => mission.getMission(organizationId, objectId),
        history: (organizationId, objectId, afterVersion, limit) => mission.getHistory(organizationId, objectId, afterVersion, limit),
      }],
      ["tasks", {
        list: (organizationId) => work.listTasks(organizationId),
        get: (organizationId, objectId) => work.getTask(organizationId, objectId),
        history: (organizationId, objectId, afterVersion, limit) => work.getHistory(organizationId, objectId, afterVersion, limit),
      }],
      ["timelines", {
        list: (organizationId) => timeline.listTimelines(organizationId),
        get: (organizationId, objectId) => timeline.getTimeline(organizationId, objectId),
        history: (organizationId, objectId, afterVersion, limit) => timeline.getHistory(organizationId, objectId, afterVersion, limit),
      }],
      ["reports", {
        list: (organizationId) => reporting.listReports(organizationId),
        get: (organizationId, objectId) => reporting.getReport(organizationId, objectId),
        history: (organizationId, objectId, afterVersion, limit) => reporting.getHistory(organizationId, objectId, afterVersion, limit),
      }],
    ]);
  }

  async handle(request: ApiRequest): Promise<ApiResponse> {
    try {
      if (this.#closed) throw new Error("application is closed");
      return await this.#dispatch(request);
    } catch (error) {
      return errorResponse(error, this.#logError);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#database?.close();
  }

  async #dispatch(request: ApiRequest): Promise<ApiResponse> {
    const url = new URL(request.path, "http://onyx.local");
    if (request.method === "GET" && url.pathname === "/healthz") {
      return {status: 200, body: {status: "ok", contexts: ["mission", "work", "timeline", "reporting-evidence"]}};
    }

    const commandMatch = url.pathname.match(/^\/v1\/([^/]+)\/commands\/([^/]+)$/);
    if (request.method === "POST" && commandMatch) {
      const commandContext = commandMatch[1]!;
      const routeType = commandMatch[2]!;
      const execute = this.#commands.get(commandContext);
      if (!execute) return notFound();
      if ((request.body as {command_type?: string})?.command_type !== routeType) {
        throw new OnyxError("INVALID_ARGUMENT", "command_type must match the command route");
      }
      return {status: 202, body: await execute(request.body)};
    }

    if (request.method === "GET") {
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments[0] === "v1" && segments[1] !== undefined) {
        const resource = this.#resources.get(segments[1]);
        const collectionRoute = segments.length === 2;
        const itemRoute = segments.length === 3;
        const historyRoute = segments.length === 4 && segments[3] === "history";
        if (resource && (collectionRoute || itemRoute || historyRoute)) {
          const organizationId = url.searchParams.get("organization_id");
          if (!organizationId) throw new OnyxError("INVALID_ARGUMENT", "organization_id is required");
          if (collectionRoute) return {status: 200, body: {items: await resource.list(organizationId)}};
          if (itemRoute) return {status: 200, body: await resource.get(organizationId, segments[2]!)};
          if (historyRoute) {
            const afterVersion = Number(url.searchParams.get("after_version") ?? "0");
            const limit = Number(url.searchParams.get("limit") ?? "100");
            return {status: 200, body: {items: await resource.history(organizationId, segments[2]!, afterVersion, limit)}};
          }
        }
      }
    }
    return notFound();
  }
}

function notFound(): ApiResponse {
  return {status: 404, body: {code: "NOT_FOUND", message: "route not found"}};
}

export function errorResponse(error: unknown, logError: (error: unknown) => void = console.error): ApiResponse {
  if (error instanceof OnyxError) {
    return {
      status: error.httpStatus,
      body: {code: error.code, message: error.message, ...(error.details ? {details: error.details} : {})},
    };
  }
  logError(error);
  return {status: 500, body: {code: "INTERNAL_ERROR", message: "unexpected failure"}};
}
