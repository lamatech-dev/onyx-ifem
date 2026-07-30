import { OnyxError } from "../contracts/errors.ts";
import { JwtVerifier, type AccessTokenClaims, type JwtVerifierOptions } from "../auth/jwt.ts";
import { SqliteDatabase } from "../infrastructure/sqlite/database.ts";
import { type StructuredLogger, resolveRequestId } from "../infrastructure/observability/logger.ts";
import { PROMETHEUS_CONTENT_TYPE, PrometheusMetrics } from "../infrastructure/observability/metrics.ts";
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
import { InMemoryOrganizationRepository } from "../organization/repository.ts";
import { OrganizationService } from "../organization/service.ts";
import { SqliteOrganizationRepository } from "../organization/sqlite-repository.ts";
import { InMemoryIdentityRepository } from "../identity-authority/repository.ts";
import { IdentityService } from "../identity-authority/service.ts";
import { SqliteIdentityRepository } from "../identity-authority/sqlite-repository.ts";
import { InMemoryContextLinkRepository } from "../context-link/repository.ts";
import { ContextLinkService } from "../context-link/service.ts";
import { SqliteContextLinkRepository } from "../context-link/sqlite-repository.ts";
import { InMemoryMeetingRepository } from "../meeting/repository.ts";
import { MeetingService } from "../meeting/service.ts";
import { SqliteMeetingRepository } from "../meeting/sqlite-repository.ts";
import{InMemoryConversationRepository}from"../conversation/repository.ts";import{ConversationService}from"../conversation/service.ts";import{SqliteConversationRepository}from"../conversation/sqlite-repository.ts";
import{InMemoryFileRepository}from"../file/repository.ts";import{FileService}from"../file/service.ts";import{SqliteFileRepository}from"../file/sqlite-repository.ts";
import{InMemoryApprovalRepository}from"../approval/repository.ts";import{ApprovalService}from"../approval/service.ts";import{SqliteApprovalRepository}from"../approval/sqlite-repository.ts";
import { OPENAPI_DOCUMENT } from "./openapi.ts";
import { encodeCursor, readCollectionQuery, readHistoryQuery, readItemQuery } from "./query.ts";
import { allowedMethodsForPath } from "./routes.ts";
import { uuidV7 } from "../shared/identifiers.ts";

export interface ApiRequest {
  method: string;
  path: string;
  body?: unknown;
  headers?: Readonly<Record<string, string | undefined>>;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers?: Readonly<Record<string, string>>;
}

export interface OnyxApplicationOptions {
  databasePath?: string;
  now?: () => Date;
  replicaIds?: Partial<Record<"mission" | "work" | "timeline" | "reportingEvidence" | "organization" | "identityAuthority" | "context" | "meeting" | "communication"|"file"|"approval", string>>;
  logError?: (error: unknown) => void;
  logger?: StructuredLogger;
  monotonicNow?: () => number;
  auth?: JwtVerifierOptions;
  metrics?: PrometheusMetrics;
}

interface ResourceRoutes {
  list: (organizationId: string, afterId: string | undefined, limit: number) => Promise<ResourcePage>;
  get: (organizationId: string, objectId: string) => Promise<unknown>;
  history: (organizationId: string, objectId: string, afterVersion: number, limit: number) => Promise<unknown[]>;
}

interface ResourcePage {
  items: unknown[];
  next_cursor?: string;
}

export class OnyxApplication {
  readonly #database: SqliteDatabase | undefined;
  readonly #commands: ReadonlyMap<string, (body: unknown) => Promise<unknown>>;
  readonly #resources: ReadonlyMap<string, ResourceRoutes>;
  readonly #logError: (error: unknown) => void;
  readonly #logger: StructuredLogger;
  readonly #now: () => Date;
  readonly #monotonicNow: () => number;
  readonly #auth: JwtVerifier | undefined;
  readonly #metrics: PrometheusMetrics;
  #closed = false;

  constructor(options: OnyxApplicationOptions = {}) {
    this.#database = options.databasePath ? new SqliteDatabase(options.databasePath) : undefined;
    this.#logError = options.logError ?? console.error;
    this.#logger = options.logger ?? (() => undefined);
    this.#now = options.now ?? (() => new Date());
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.#auth = options.auth
      ? new JwtVerifier({...options.auth, ...(!options.auth.now && options.now ? {now: options.now} : {})})
      : undefined;
    this.#metrics = options.metrics ?? new PrometheusMetrics();
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
    const organization = new OrganizationService(
      this.#database ? new SqliteOrganizationRepository(this.#database) : new InMemoryOrganizationRepository(),
      {...time, replicaId: options.replicaIds?.organization ?? "organization-api"},
    );
    const identity = new IdentityService(
      this.#database ? new SqliteIdentityRepository(this.#database) : new InMemoryIdentityRepository(),
      {...time, replicaId: options.replicaIds?.identityAuthority ?? "identity-authority-api"},
    );
    const contextLink = new ContextLinkService({
      repository: this.#database ? new SqliteContextLinkRepository(this.#database) : new InMemoryContextLinkRepository(),
      ...time,
      replicaId: options.replicaIds?.context ?? "context-api",
      requireObject: async (organizationId, reference) => {
        if (reference.aggregate_type === "Mission") return void await mission.getMission(organizationId, reference.object_id);
        if (reference.aggregate_type === "Task") return void await work.getTask(organizationId, reference.object_id);
        if (reference.aggregate_type === "Timeline") return void await timeline.getTimeline(organizationId, reference.object_id);
        if (reference.aggregate_type === "Report") return void await reporting.getReport(organizationId, reference.object_id);
        if (reference.aggregate_type === "User") return void await identity.getUser(organizationId, reference.object_id);
        if (reference.aggregate_type === "Organization" && organizationId === reference.object_id) return void await organization.getOrganization(reference.object_id);
        throw new OnyxError("INVALID_ARGUMENT", `unsupported context object type: ${reference.aggregate_type}`);
      },
    });
    const meeting = new MeetingService({repository:this.#database?new SqliteMeetingRepository(this.#database):new InMemoryMeetingRepository(),...time,replicaId:options.replicaIds?.meeting??"meeting-api",requireUser:async(organizationId,userId)=>{const user=await identity.getUser(organizationId,userId);if(user.status!=="ACTIVE")throw new OnyxError("INVALID_STATE_TRANSITION","meeting participant is disabled");}});
    const conversation=new ConversationService({repository:this.#database?new SqliteConversationRepository(this.#database):new InMemoryConversationRepository(),...time,replicaId:options.replicaIds?.communication??"communication-api",requireUser:async(organizationId,userId)=>{const user=await identity.getUser(organizationId,userId);if(user.status!=="ACTIVE")throw new OnyxError("INVALID_STATE_TRANSITION","conversation user is disabled")},requireTopic:async(organizationId,reference)=>{if(reference.aggregate_type==="Mission")return void await mission.getMission(organizationId,reference.object_id);if(reference.aggregate_type==="Task")return void await work.getTask(organizationId,reference.object_id);if(reference.aggregate_type==="Timeline")return void await timeline.getTimeline(organizationId,reference.object_id);if(reference.aggregate_type==="Report")return void await reporting.getReport(organizationId,reference.object_id);if(reference.aggregate_type==="User")return void await identity.getUser(organizationId,reference.object_id);if(reference.aggregate_type==="Organization"&&organizationId===reference.object_id)return void await organization.getOrganization(reference.object_id);if(reference.aggregate_type==="ContextLink")return void await contextLink.getContextLink(organizationId,reference.object_id);if(reference.aggregate_type==="Meeting")return void await meeting.getMeeting(organizationId,reference.object_id);throw new OnyxError("INVALID_ARGUMENT",`unsupported conversation topic type: ${reference.aggregate_type}`)}});
    const file=new FileService({repository:this.#database?new SqliteFileRepository(this.#database):new InMemoryFileRepository(),...time,replicaId:options.replicaIds?.file??"file-api",requireOwner:async(organizationId,userId)=>{const user=await identity.getUser(organizationId,userId);if(user.status!=="ACTIVE")throw new OnyxError("INVALID_STATE_TRANSITION","file owner is disabled")}});
    const approval=new ApprovalService({repository:this.#database?new SqliteApprovalRepository(this.#database):new InMemoryApprovalRepository(),...time,replicaId:options.replicaIds?.approval??"approval-api",requireUser:async(organizationId,userId)=>{const user=await identity.getUser(organizationId,userId);if(user.status!=="ACTIVE")throw new OnyxError("INVALID_STATE_TRANSITION","approval user is disabled")},requireSubject:async(organizationId,reference)=>{if(reference.aggregate_type==="Mission")return void await mission.getMission(organizationId,reference.object_id);if(reference.aggregate_type==="Task")return void await work.getTask(organizationId,reference.object_id);if(reference.aggregate_type==="Timeline")return void await timeline.getTimeline(organizationId,reference.object_id);if(reference.aggregate_type==="Report")return void await reporting.getReport(organizationId,reference.object_id);if(reference.aggregate_type==="Meeting")return void await meeting.getMeeting(organizationId,reference.object_id);if(reference.aggregate_type==="Conversation")return void await conversation.getConversation(organizationId,reference.object_id);if(reference.aggregate_type==="FileAsset")return void await file.getFile(organizationId,reference.object_id);throw new OnyxError("INVALID_ARGUMENT",`unsupported approval subject type: ${reference.aggregate_type}`)}});

    this.#commands = new Map<string, (body: unknown) => Promise<unknown>>([
      ["mission", (body) => mission.execute(body)],
      ["work", (body) => work.execute(body)],
      ["timeline", (body) => timeline.execute(body)],
      ["reporting-evidence", (body) => reporting.execute(body)],
      ["organization", (body) => organization.execute(body)],
      ["identity-authority", (body) => identity.execute(body)],
      ["context", (body) => contextLink.execute(body)],
      ["meeting", (body) => meeting.execute(body)],
      ["communication",body=>conversation.execute(body)],
      ["file",body=>file.execute(body)],
      ["approval",body=>approval.execute(body)],
    ]);
    this.#resources = new Map([
      ["missions", {
        list: async (organizationId, afterId, limit) => page(
          await mission.listMissions(organizationId, afterId, limit + 1), limit, (item) => item.mission_id,
        ),
        get: (organizationId, objectId) => mission.getMission(organizationId, objectId),
        history: (organizationId, objectId, afterVersion, limit) => mission.getHistory(organizationId, objectId, afterVersion, limit),
      }],
      ["tasks", {
        list: async (organizationId, afterId, limit) => page(
          await work.listTasks(organizationId, afterId, limit + 1), limit, (item) => item.task_id,
        ),
        get: (organizationId, objectId) => work.getTask(organizationId, objectId),
        history: (organizationId, objectId, afterVersion, limit) => work.getHistory(organizationId, objectId, afterVersion, limit),
      }],
      ["timelines", {
        list: async (organizationId, afterId, limit) => page(
          await timeline.listTimelines(organizationId, afterId, limit + 1), limit, (item) => item.timeline_id,
        ),
        get: (organizationId, objectId) => timeline.getTimeline(organizationId, objectId),
        history: (organizationId, objectId, afterVersion, limit) => timeline.getHistory(organizationId, objectId, afterVersion, limit),
      }],
      ["reports", {
        list: async (organizationId, afterId, limit) => page(
          await reporting.listReports(organizationId, afterId, limit + 1), limit, (item) => item.report_id,
        ),
        get: (organizationId, objectId) => reporting.getReport(organizationId, objectId),
        history: (organizationId, objectId, afterVersion, limit) => reporting.getHistory(organizationId, objectId, afterVersion, limit),
      }],
      ["organizations", {
        list: async (organizationId, afterId, limit) => page(await organization.listOrganizations(organizationId, afterId, limit + 1), limit, (item) => item.organization_id),
        get: (organizationId, objectId) => {
          if (organizationId !== objectId) throw new OnyxError("ORGANIZATION_MISMATCH", "organization query must match object id");
          return organization.getOrganization(objectId);
        },
        history: (organizationId, objectId, afterVersion, limit) => {
          if (organizationId !== objectId) throw new OnyxError("ORGANIZATION_MISMATCH", "organization query must match object id");
          return organization.getHistory(objectId, afterVersion, limit);
        },
      }],
      ["users", {
        list: async (organizationId, afterId, limit) => page(await identity.listUsers(organizationId, afterId, limit + 1), limit, (item) => item.user_id),
        get: (organizationId, objectId) => identity.getUser(organizationId, objectId),
        history: (organizationId, objectId, afterVersion, limit) => identity.getHistory(organizationId, objectId, afterVersion, limit),
      }],
      ["context-links", {
        list: async (organizationId, afterId, limit) => page(await contextLink.listContextLinks(organizationId, afterId, limit + 1), limit, (item) => item.context_link_id),
        get: (organizationId, objectId) => contextLink.getContextLink(organizationId, objectId),
        history: (organizationId, objectId, afterVersion, limit) => contextLink.getHistory(organizationId, objectId, afterVersion, limit),
      }],
      ["meetings", {list:async(organizationId,afterId,limit)=>page(await meeting.listMeetings(organizationId,afterId,limit+1),limit,item=>item.meeting_id),get:(organizationId,objectId)=>meeting.getMeeting(organizationId,objectId),history:(organizationId,objectId,afterVersion,limit)=>meeting.getHistory(organizationId,objectId,afterVersion,limit)}],
      ["conversations",{list:async(organizationId,afterId,limit)=>page(await conversation.listConversations(organizationId,afterId,limit+1),limit,item=>item.conversation_id),get:(organizationId,objectId)=>conversation.getConversation(organizationId,objectId),history:(organizationId,objectId,afterVersion,limit)=>conversation.getHistory(organizationId,objectId,afterVersion,limit)}],
      ["files",{list:async(organizationId,afterId,limit)=>page(await file.listFiles(organizationId,afterId,limit+1),limit,item=>item.file_id),get:(organizationId,objectId)=>file.getFile(organizationId,objectId),history:(organizationId,objectId,afterVersion,limit)=>file.getHistory(organizationId,objectId,afterVersion,limit)}],
      ["approvals",{list:async(organizationId,afterId,limit)=>page(await approval.listApprovals(organizationId,afterId,limit+1),limit,item=>item.approval_id),get:(organizationId,objectId)=>approval.getApproval(organizationId,objectId),history:(organizationId,objectId,afterVersion,limit)=>approval.getHistory(organizationId,objectId,afterVersion,limit)}],
    ]);
  }

  async handle(request: ApiRequest): Promise<ApiResponse> {
    const startedAt = this.#monotonicNow();
    const requestId = resolveRequestId(request.headers?.["x-request-id"], () => uuidV7(this.#now()));
    let failure: unknown;
    let response: ApiResponse;
    try {
      if (this.#closed) throw new Error("application is closed");
      response = await this.#dispatch(request);
    } catch (error) {
      failure = error;
      response = errorResponse(error, this.#logError);
    }
    const completed = withRequestId(response, requestId);
    this.#writeRequestLog(request, completed, requestId, startedAt, failure);
    return completed;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#database?.close();
  }

  async #dispatch(request: ApiRequest): Promise<ApiResponse> {
    const url = new URL(request.path, "http://onyx.local");
    const allowedMethods = allowedMethodsForPath(url.pathname);
    if (allowedMethods && !allowedMethods.includes(request.method)) return methodNotAllowed(allowedMethods);
    const method = request.method === "HEAD" ? "GET" : request.method;

    if (method === "GET" && url.pathname === "/healthz") {
      return {status: 200, body: {status: "ok", contexts: ["mission", "work", "timeline", "reporting-evidence", "organization", "identity-authority", "context", "meeting", "communication","file","approval"]}};
    }
    if (method === "GET" && url.pathname === "/readyz") {
      if (!this.#database) {
        return {status: 200, body: {status: "ready", persistence: {mode: "memory", durable: false}, messaging: {enabled: false}}};
      }
      try {
        return {
          status: 200,
          body: {
            status: "ready",
            persistence: {mode: "sqlite", durable: true},
            messaging: {enabled: true, ...this.#database.readiness(this.#now())},
          },
        };
      } catch (error) {
        this.#logError(error);
        return {status: 503, body: {status: "not_ready", persistence: {mode: "sqlite", durable: true}}};
      }
    }
    if (method === "GET" && url.pathname === "/openapi.json") {
      return {status: 200, body: structuredClone(OPENAPI_DOCUMENT)};
    }
    if (method === "GET" && url.pathname === "/metrics") {
      const now = this.#now();
      const messaging = this.#database?.readiness(now);
      return {
        status: 200,
        body: this.#metrics.render({durable: this.#database !== undefined, now, ...(messaging ? {messaging} : {})}),
        headers: {"cache-control": "no-store", "content-type": PROMETHEUS_CONTENT_TYPE},
      };
    }

    const commandMatch = url.pathname.match(/^\/v1\/([^/]+)\/commands\/([^/]+)$/);
    if (method === "POST" && commandMatch) {
      const commandContext = commandMatch[1]!;
      const routeType = commandMatch[2]!;
      const execute = this.#commands.get(commandContext);
      if (!execute) return notFound();
      const claims = this.#authenticate(request);
      if ((request.body as {command_type?: string})?.command_type !== routeType) {
        throw new OnyxError("INVALID_ARGUMENT", "command_type must match the command route");
      }
      if (claims) this.#authorizeCommand(claims, request.body);
      return {status: 202, body: await execute(request.body)};
    }

    if (method === "GET") {
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments[0] === "v1" && segments[1] !== undefined) {
        const resource = this.#resources.get(segments[1]);
        const collectionRoute = segments.length === 2;
        const itemRoute = segments.length === 3;
        const historyRoute = segments.length === 4 && segments[3] === "history";
        if (resource && (collectionRoute || itemRoute || historyRoute)) {
          if (collectionRoute) {
            const query = readCollectionQuery(url);
            const claims = this.#authenticate(request);
            if (claims) this.#authorizeRead(claims, query.organizationId, segments[1]);
            return {status: 200, body: await resource.list(query.organizationId, query.afterId, query.limit)};
          }
          const objectId = segments[2]!;
          if (itemRoute) {
            const query = readItemQuery(url, objectId);
            const claims = this.#authenticate(request);
            if (claims) this.#authorizeRead(claims, query.organizationId, segments[1]);
            return {status: 200, body: await resource.get(query.organizationId, objectId)};
          }
          if (historyRoute) {
            const query = readHistoryQuery(url, objectId);
            const claims = this.#authenticate(request);
            if (claims) this.#authorizeRead(claims, query.organizationId, segments[1]);
            return {status: 200, body: {items: await resource.history(query.organizationId, objectId, query.afterVersion, query.limit)}};
          }
        }
      }
    }
    return notFound();
  }

  #authenticate(request: ApiRequest): AccessTokenClaims | undefined {
    return this.#auth?.authenticate(request.headers?.authorization);
  }

  #authorizeCommand(claims: AccessTokenClaims, body: unknown): void {
    const command = body as Record<string, any>;
    if (command?.organization_id !== claims.org) throw new OnyxError("ORGANIZATION_MISMATCH", "token organization does not match command");
    if (command?.actor_context?.principal_id !== claims.sub || command?.actor_context?.actor_type !== claims.actor_type) {
      throw new OnyxError("AUTHORITY_PROOF_INVALID", "token subject does not match actor_context");
    }
    const proof = command?.authority_proof;
    if (proof?.proof_ref !== claims.jti || proof?.authority_epoch !== claims.authority_epoch) {
      throw new OnyxError("AUTHORITY_PROOF_INVALID", "token does not match authority proof identity or epoch");
    }
    if (!Array.isArray(proof.scope) || proof.scope.some((scope: unknown) => typeof scope !== "string" || !claims.scope.includes(scope))) {
      throw new OnyxError("AUTHORITY_PROOF_INVALID", "authority proof exceeds token scope");
    }
    const proofExpiry = Date.parse(proof.expires_at);
    if (!Number.isFinite(proofExpiry) || proofExpiry > claims.exp * 1_000) {
      throw new OnyxError("AUTHORITY_PROOF_INVALID", "authority proof expiry exceeds token expiry");
    }
  }

  #authorizeRead(claims: AccessTokenClaims, organizationId: string, resource: string): void {
    if (claims.org !== organizationId) throw new OnyxError("ORGANIZATION_MISMATCH", "token organization does not match query");
    const requiredScope: Record<string, string> = {
      missions: "mission:read",
      tasks: "work:read",
      timelines: "timeline:read",
      reports: "reporting-evidence:read",
      organizations: "organization:read",
      users: "identity-authority:read",
      "context-links": "context:read",
      meetings: "meeting:read",
      conversations: "communication:read",
      files: "file:read",
      approvals: "approval:read",
    };
    if (!claims.scope.includes(requiredScope[resource]!)) {
      throw new OnyxError("AUTHORITY_PROOF_INVALID", `${requiredScope[resource]} authority is missing`);
    }
  }

  #writeRequestLog(request: ApiRequest, response: ApiResponse, requestId: string, startedAt: number, failure: unknown): void {
    const body = response.body as {code?: unknown};
    const record = {
      timestamp: this.#now().toISOString(),
      level: response.status >= 500 ? "error" as const : response.status >= 400 ? "warn" as const : "info" as const,
      event: "http.request.completed" as const,
      request_id: requestId,
      method: request.method,
      path: new URL(request.path, "http://onyx.local").pathname,
      status: response.status,
      duration_ms: Math.max(0, Math.round((this.#monotonicNow() - startedAt) * 1_000) / 1_000),
      ...(typeof body?.code === "string" ? {error_code: body.code} : {}),
      ...(failure instanceof Error ? {error_name: failure.name} : {}),
    };
    try {
      this.#logger(record);
    } catch (error) {
      this.#logError(error);
    }
  }
}

function withRequestId(response: ApiResponse, requestId: string): ApiResponse {
  return {...response, headers: {...response.headers, "x-request-id": requestId}};
}

function notFound(): ApiResponse {
  return {status: 404, body: {code: "NOT_FOUND", message: "route not found"}};
}

function methodNotAllowed(allowedMethods: readonly string[]): ApiResponse {
  return {
    status: 405,
    body: {code: "INVALID_ARGUMENT", message: "method is not allowed for route"},
    headers: {allow: allowedMethods.join(", ")},
  };
}

function page<T>(items: T[], limit: number, objectId: (item: T) => string): ResourcePage {
  const hasMore = items.length > limit;
  const visible = hasMore ? items.slice(0, limit) : items;
  return {
    items: visible,
    ...(hasMore ? {next_cursor: encodeCursor(objectId(visible[visible.length - 1]!))} : {}),
  };
}

export function errorResponse(error: unknown, logError: (error: unknown) => void = console.error): ApiResponse {
  if (error instanceof OnyxError) {
    return {
      status: error.httpStatus,
      body: {code: error.code, message: error.message, ...(error.details ? {details: error.details} : {})},
      ...(error.code === "AUTHENTICATION_REQUIRED" ? {headers: {"www-authenticate": "Bearer"}} : {}),
    };
  }
  logError(error);
  return {status: 500, body: {code: "INTERNAL_ERROR", message: "unexpected failure"}};
}
