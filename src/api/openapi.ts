import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, any>;

interface CommandRoute {
  context: "mission" | "work" | "timeline" | "reporting-evidence" | "organization" | "identity-authority" | "context" | "meeting" | "communication"|"file"|"approval"|"capacity";
  command: string;
  event: string;
}

const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const contractsRoot = fileURLToPath(new URL("../../contracts/v2.0/", import.meta.url));

export const IMPLEMENTED_COMMAND_ROUTES: readonly CommandRoute[] = [
  {context: "mission", command: "CreateMission", event: "MissionCreated"},
  {context: "mission", command: "CreateBlueprintRevision", event: "MissionBlueprintRevisionCreated"},
  {context: "mission", command: "SubmitBlueprint", event: "MissionBlueprintSubmitted"},
  {context: "mission", command: "ActivateMission", event: "MissionActivated"},
  {context: "mission", command: "PauseMission", event: "MissionPaused"},
  {context: "mission", command: "ResumeMission", event: "MissionResumed"},
  {context: "mission", command: "OperationalHaltMission", event: "MissionOperationallyHalted"},
  {context: "mission", command: "RestartMission", event: "MissionRestarted"},
  {context: "mission", command: "CloseMission", event: "MissionClosed"},
  {context: "mission", command: "CancelMission", event: "MissionCancelled"},
  {context: "mission", command: "ArchiveMission", event: "MissionArchived"},
  {context: "work", command: "CreateTask", event: "TaskCreated"},
  {context: "work", command: "AssignOwner", event: "TaskOwnerAssigned"},
  {context: "work", command: "ChangePriority", event: "TaskPriorityChanged"},
  {context: "work", command: "AddDependency", event: "TaskDependencyAdded"},
  {context: "work", command: "StartTask", event: "TaskStarted"},
  {context: "work", command: "PauseTask", event: "TaskPaused"},
  {context: "work", command: "BlockTask", event: "TaskBlocked"},
  {context: "work", command: "SubmitCompletion", event: "TaskCompletionSubmitted"},
  {context: "work", command: "ApproveTask", event: "TaskApproved"},
  {context: "work", command: "ReopenTask", event: "TaskReopened"},
  {context: "work", command: "CloseTask", event: "TaskClosed"},
  {context: "work", command: "CancelTask", event: "TaskCancelled"},
  {context: "timeline", command: "CreateTimeline", event: "TimelineCreated"},
  {context: "timeline", command: "SetDeadline", event: "DeadlineChanged"},
  {context: "timeline", command: "MoveDeadline", event: "DeadlineMoved"},
  {context: "timeline", command: "AddMilestone", event: "MilestoneAdded"},
  {context: "timeline", command: "DefineCriticalMarker", event: "CriticalMarkerDefined"},
  {context: "timeline", command: "ActivatePenaltyZone", event: "PenaltyZoneActivated"},
  {context: "timeline", command: "ResolveScheduleException", event: "ScheduleExceptionRaised"},
  {context: "timeline", command: "ArchiveTimeline", event: "TimelineArchived"},
  {context: "reporting-evidence", command: "CreateReport", event: "ReportCreated"},
  {context: "reporting-evidence", command: "AddEvidence", event: "EvidenceAdded"},
  {context: "reporting-evidence", command: "VerifyEvidence", event: "EvidenceVerified"},
  {context: "reporting-evidence", command: "RejectEvidence", event: "EvidenceRejected"},
  {context: "reporting-evidence", command: "SubmitReport", event: "ReportSubmitted"},
  {context: "reporting-evidence", command: "ApproveReport", event: "ReportApproved"},
  {context: "reporting-evidence", command: "RejectReport", event: "ReportRejected"},
  {context: "reporting-evidence", command: "ArchiveReport", event: "ReportArchived"},
  {context: "organization", command: "CreateOrganization", event: "OrganizationCreated"},
  {context: "organization", command: "CreateWorkspace", event: "WorkspaceCreated"},
  {context: "organization", command: "CreateDepartment", event: "DepartmentCreated"},
  {context: "organization", command: "CreateTeam", event: "TeamCreated"},
  {context: "organization", command: "CreateGroup", event: "GroupCreated"},
  {context: "organization", command: "MoveTeam", event: "TeamMoved"},
  {context: "organization", command: "ArchiveDepartment", event: "DepartmentArchived"},
  {context: "organization", command: "ArchiveOrganization", event: "OrganizationArchived"},
  {context: "identity-authority", command: "CreateUser", event: "UserCreated"},
  {context: "identity-authority", command: "AssignRole", event: "RoleAssigned"},
  {context: "identity-authority", command: "RevokeRole", event: "RoleRevoked"},
  {context: "identity-authority", command: "RegisterDevice", event: "DeviceRegistered"},
  {context: "identity-authority", command: "RevokeDevice", event: "DeviceRevoked"},
  {context: "identity-authority", command: "DelegateAuthority", event: "AuthorityDelegated"},
  {context: "identity-authority", command: "RevokeDelegation", event: "DelegationRevoked"},
  {context: "identity-authority", command: "DisableUser", event: "UserDisabled"},
  {context: "identity-authority", command: "EnableUser", event: "UserEnabled"},
  {context: "context", command: "CreateContextLink", event: "ContextLinkCreated"},
  {context: "context", command: "UpdateContextMetadata", event: "ContextMetadataUpdated"},
  {context: "context", command: "ChangeContextStrength", event: "ContextStrengthChanged"},
  {context: "context", command: "ArchiveContextLink", event: "ContextLinkArchived"},
  {context: "context", command: "RestoreContextLink", event: "ContextLinkRestored"},
  {context:"meeting",command:"CreateMeeting",event:"MeetingCreated"},
  {context:"meeting",command:"InviteParticipant",event:"ParticipantInvited"},
  {context:"meeting",command:"RemoveParticipant",event:"ParticipantRemoved"},
  {context:"meeting",command:"StartMeeting",event:"MeetingStarted"},
  {context:"meeting",command:"RecordDecision",event:"DecisionRecorded"},
  {context:"meeting",command:"ProposeActionItem",event:"ActionItemProposed"},
  {context:"meeting",command:"EndMeeting",event:"MeetingEnded"},
  {context:"meeting",command:"CancelMeeting",event:"MeetingCancelled"},
  {context:"communication",command:"CreateConversation",event:"ConversationCreated"},{context:"communication",command:"AddMember",event:"ConversationMemberAdded"},{context:"communication",command:"PostMessage",event:"MessagePosted"},{context:"communication",command:"EditMessage",event:"MessageEdited"},{context:"communication",command:"RedactMessage",event:"MessageRedacted"},{context:"communication",command:"AddReaction",event:"ReactionAdded"},{context:"communication",command:"RemoveReaction",event:"ReactionRemoved"},{context:"communication",command:"ArchiveConversation",event:"ConversationArchived"},
  {context:"file",command:"CreateFileAsset",event:"FileAssetCreated"},{context:"file",command:"StartUpload",event:"UploadStarted"},{context:"file",command:"AppendChunk",event:"ChunkAccepted"},{context:"file",command:"FinalizeUpload",event:"UploadFinalized"},{context:"file",command:"CreateVersion",event:"FileVersionCreated"},{context:"file",command:"GrantFileAccess",event:"FileAccessGranted"},{context:"file",command:"RevokeFileAccess",event:"FileAccessRevoked"},{context:"file",command:"QuarantineFile",event:"FileQuarantined"},{context:"file",command:"ArchiveFile",event:"FileArchived"},
  {context:"approval",command:"CreateApproval",event:"ApprovalCreated"},{context:"approval",command:"AssignApprover",event:"ApproverAssigned"},{context:"approval",command:"Approve",event:"ApprovalGranted"},{context:"approval",command:"Reject",event:"ApprovalRejected"},{context:"approval",command:"RequestChanges",event:"ChangesRequested"},{context:"approval",command:"DelegateApproval",event:"ApprovalDelegated"},{context:"approval",command:"EscalateApproval",event:"ApprovalEscalated"},{context:"approval",command:"CancelApproval",event:"ApprovalCancelled"},{context:"approval",command:"ReverseApproval",event:"ApprovalReversed"},{context:"approval",command:"ReopenApproval",event:"ApprovalReopened"},
  {context:"capacity",command:"CreateCapacityProfile",event:"CapacityProfileCreated"},{context:"capacity",command:"UpdateAvailability",event:"AvailabilityUpdated"},{context:"capacity",command:"AllocateWorkload",event:"WorkloadAllocated"},{context:"capacity",command:"CaptureCapacitySnapshot",event:"CapacitySnapshotCaptured"},{context:"capacity",command:"RecalculateCapacity",event:"CapacityRecalculated"},{context:"capacity",command:"ArchiveCapacityProfile",event:"CapacityProfileArchived"},
];

function readSchema(path: string): JsonObject {
  return JSON.parse(readFileSync(`${contractsRoot}${path}`, "utf8")) as JsonObject;
}

function bundled(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(bundled);
  if (value === null || typeof value !== "object") return value;
  const output: JsonObject = {};
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (key === "$ref" && typeof child === "string") {
      const typesUri = "https://contracts.onyx.local/shared/types.schema.json";
      if (child.startsWith(typesUri)) {
        output[key] = `#/components/schemas/SharedTypes${child.slice(typesUri.length).replace(/^#/, "")}`;
      } else if (child.startsWith("types.schema.json")) {
        output[key] = `#/components/schemas/SharedTypes${child.slice("types.schema.json".length).replace(/^#/, "")}`;
      } else if (child.startsWith("#/$defs/")) {
        output[key] = `#/components/schemas/SharedTypes${child.slice(1)}`;
      } else {
        output[key] = child
          .replace("https://contracts.onyx.local/shared/command-envelope.schema.json", "#/components/schemas/CommandEnvelope")
          .replace("https://contracts.onyx.local/shared/event-envelope.schema.json", "#/components/schemas/EventEnvelope");
      }
    } else {
      output[key] = bundled(child);
    }
  }
  return output;
}

function contractSchema(kind: "commands" | "events", context: string, name: string): JsonObject {
  return bundled(readSchema(`${kind}/${context}/${name}.schema.json`)) as JsonObject;
}

function jsonContent(schema: JsonObject): JsonObject {
  return {"application/json": {schema}};
}

const errorResponses: JsonObject = Object.fromEntries(
  ["400", "401", "403", "404", "409", "422", "429", "500", "503"].map((status) => [status, {$ref: `#/components/responses/Error${status}`}]),
);

const paths: JsonObject = {};
for (const route of IMPLEMENTED_COMMAND_ROUTES) {
  paths[`/v1/${route.context}/commands/${route.command}`] = {
    post: {
      operationId: route.command[0]!.toLowerCase() + route.command.slice(1),
      tags: [route.context],
      summary: `Execute ${route.command}`,
      security: [{BearerAuth: []}],
      requestBody: {
        required: true,
        content: jsonContent({$ref: `#/components/schemas/${route.command}`}),
      },
      responses: {
        "202": {
          description: `${route.event} accepted`,
          content: jsonContent({$ref: `#/components/schemas/${route.event}`}),
        },
        ...errorResponses,
      },
      "x-onyx-command": route.command,
      "x-onyx-event": route.event,
    },
  };
}

const organizationParameter = {$ref: "#/components/parameters/OrganizationId"};
const queryErrors = {
  "400": {$ref: "#/components/responses/Error400"},
  "401": {$ref: "#/components/responses/Error401"},
  "403": {$ref: "#/components/responses/Error403"},
  "404": {$ref: "#/components/responses/Error404"},
  "429": {$ref: "#/components/responses/Error429"},
  "500": {$ref: "#/components/responses/Error500"},
  "503": {$ref: "#/components/responses/Error503"},
};

function addResource(resource: string, singular: string, schema: string, events: string[]): void {
  const tag = singular.toLowerCase();
  paths[`/v1/${resource}`] = {
    get: {
      operationId: `list${singular}s`,
      tags: [tag],
      security: [{BearerAuth: []}],
      parameters: [
        organizationParameter,
        {$ref: "#/components/parameters/Cursor"},
        {$ref: "#/components/parameters/Limit"},
      ],
      responses: {
        "200": {
          description: `${singular} collection`,
          content: jsonContent({
            type: "object",
            additionalProperties: false,
            required: ["items"],
            properties: {
              items: {type: "array", items: {$ref: `#/components/schemas/${schema}`}},
              next_cursor: {type: "string", minLength: 1, description: "Opaque cursor for the next page"},
            },
          }),
        },
        ...queryErrors,
      },
    },
  };
  paths[`/v1/${resource}/{id}`] = {
    get: {
      operationId: `get${singular}`,
      tags: [tag],
      security: [{BearerAuth: []}],
      parameters: [{$ref: "#/components/parameters/ObjectId"}, organizationParameter],
      responses: {
        "200": {description: `${singular} view`, content: jsonContent({$ref: `#/components/schemas/${schema}`})},
        ...queryErrors,
      },
    },
  };
  paths[`/v1/${resource}/{id}/history`] = {
    get: {
      operationId: `get${singular}History`,
      tags: [tag],
      security: [{BearerAuth: []}],
      parameters: [
        {$ref: "#/components/parameters/ObjectId"},
        organizationParameter,
        {$ref: "#/components/parameters/AfterVersion"},
        {$ref: "#/components/parameters/Limit"},
      ],
      responses: {
        "200": {
          description: `${singular} event history`,
          content: jsonContent({
            type: "object",
            additionalProperties: false,
            required: ["items"],
            properties: {
              items: {
                type: "array",
                items: events.length === 1
                  ? {$ref: `#/components/schemas/${events[0]}`}
                  : {oneOf: events.map((event) => ({$ref: `#/components/schemas/${event}`}))},
              },
            },
          }),
        },
        ...queryErrors,
      },
    },
  };
}

addResource("missions", "Mission", "MissionView", IMPLEMENTED_COMMAND_ROUTES.filter((route) => route.context === "mission").map((route) => route.event));
addResource("tasks", "Task", "TaskView", IMPLEMENTED_COMMAND_ROUTES.filter((route) => route.context === "work").map((route) => route.event));
addResource("timelines", "Timeline", "TimelineView", IMPLEMENTED_COMMAND_ROUTES.filter((route) => route.context === "timeline").map((route) => route.event));
addResource("reports", "Report", "ReportView", IMPLEMENTED_COMMAND_ROUTES.filter((route) => route.context === "reporting-evidence").map((route) => route.event));
addResource("organizations", "Organization", "OrganizationView", IMPLEMENTED_COMMAND_ROUTES.filter((route) => route.context === "organization").map((route) => route.event));
addResource("users", "User", "UserIdentityView", IMPLEMENTED_COMMAND_ROUTES.filter((route) => route.context === "identity-authority").map((route) => route.event));
addResource("context-links", "ContextLink", "ContextLinkView", IMPLEMENTED_COMMAND_ROUTES.filter((route) => route.context === "context").map((route) => route.event));
addResource("meetings","Meeting","MeetingView",IMPLEMENTED_COMMAND_ROUTES.filter(route=>route.context==="meeting").map(route=>route.event));
addResource("conversations","Conversation","ConversationView",IMPLEMENTED_COMMAND_ROUTES.filter(route=>route.context==="communication").map(route=>route.event));
addResource("files","File","FileAssetView",IMPLEMENTED_COMMAND_ROUTES.filter(route=>route.context==="file").map(route=>route.event));
addResource("approvals","Approval","ApprovalView",IMPLEMENTED_COMMAND_ROUTES.filter(route=>route.context==="approval").map(route=>route.event));
addResource("capacity-profiles","Capacity profile","CapacityProfileView",IMPLEMENTED_COMMAND_ROUTES.filter(route=>route.context==="capacity").map(route=>route.event));

paths["/healthz"] = {
  get: {
    operationId: "getHealth",
    tags: ["operations"],
    responses: {
      "200": {
        description: "Process health",
        content: jsonContent({
          type: "object",
          additionalProperties: false,
          required: ["status", "contexts"],
          properties: {
            status: {const: "ok"},
            contexts: {type: "array", items: {type: "string"}},
          },
        }),
      },
    },
  },
};

paths["/readyz"] = {
  get: {
    operationId: "getReadiness",
    tags: ["operations"],
    responses: {
      "200": {
        description: "Persistence and messaging readiness",
        content: jsonContent({type: "object"}),
      },
      "503": {
        $ref: "#/components/responses/Error503",
      },
      "429": {$ref: "#/components/responses/Error429"},
    },
  },
};

paths["/openapi.json"] = {
  get: {
    operationId: "getOpenApi",
    tags: ["operations"],
    responses: {
      "200": {description: "OpenAPI 3.1 description", content: jsonContent({type: "object"})},
      "429": {$ref: "#/components/responses/Error429"},
      "503": {$ref: "#/components/responses/Error503"},
    },
  },
};

paths["/metrics"] = {
  get: {
    operationId: "getMetrics",
    tags: ["operations"],
    responses: {
      "200": {
        description: "Prometheus text exposition for internal scraping",
        content: {
          "text/plain": {
            schema: {type: "string"},
          },
        },
      },
    },
  },
};

const viewSchemas: JsonObject = {
  MissionView: {
    type: "object",
    additionalProperties: false,
    required: ["mission_id", "organization_id", "objective", "owner_id", "status", "version", "lifecycle_epoch", "authority_epoch"],
    properties: {
      mission_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      organization_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      objective: {type: "string"},
      owner_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      status: {type: "string"},
      version: {type: "integer", minimum: 1},
      lifecycle_epoch: {type: "integer", minimum: 0},
      authority_epoch: {type: "integer", minimum: 0},
      title: {type: "string"},
      active_blueprint_revision_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      timeline_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
    },
  },
  TaskView: {
    type: "object",
    additionalProperties: false,
    required: ["task_id", "organization_id", "mission_id", "title", "description", "owner_id", "priority", "status", "version", "lifecycle_epoch", "authority_epoch", "dependency_task_ids"],
    properties: {
      task_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      organization_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      mission_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      title: {type: "string"}, description: {type: "string"},
      owner_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      priority: {type: "string"}, status: {type: "string"}, version: {type: "integer", minimum: 1},
      lifecycle_epoch: {type: "integer", minimum: 0}, authority_epoch: {type: "integer", minimum: 0},
      dependency_task_ids: {type: "array", items: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"}, uniqueItems: true},
    },
  },
  TimelineView: {
    type: "object", additionalProperties: false,
    required: ["timeline_id", "organization_id", "subject_ref", "timezone", "version", "status", "lifecycle_epoch", "authority_epoch", "deadlines", "milestones", "critical_markers", "penalty_zones", "resolved_exception_ids"],
    properties: {
      timeline_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      organization_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      subject_ref: {$ref: "#/components/schemas/SharedTypes/$defs/DomainObjectRef"},
      timezone: {type: "string", minLength: 1}, version: {type: "integer", minimum: 1},
      status: {type: "string", enum: ["ACTIVE", "ARCHIVED"]}, lifecycle_epoch: {type: "integer", minimum: 0}, authority_epoch: {type: "integer", minimum: 0},
      deadlines: {type: "object"}, milestones: {type: "object"}, critical_markers: {type: "object"}, penalty_zones: {type: "object"},
      resolved_exception_ids: {type: "array", items: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"}, uniqueItems: true},
    },
  },
  ReportView: {
    type: "object", additionalProperties: false,
    required: ["report_id", "organization_id", "report_type", "subject_ref", "author_id", "title", "version", "status", "lifecycle_epoch", "authority_epoch", "evidence"],
    properties: {
      report_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      organization_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"}, report_type: {type: "string"},
      subject_ref: {$ref: "#/components/schemas/SharedTypes/$defs/DomainObjectRef"},
      author_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      title: {type: "string", minLength: 1}, version: {type: "integer", minimum: 1},
      status: {type: "string", enum: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "ARCHIVED"]},
      lifecycle_epoch: {type: "integer", minimum: 0}, authority_epoch: {type: "integer", minimum: 0}, evidence: {type: "object"},
    },
  },
  OrganizationView: {
    type: "object", additionalProperties: false,
    required: ["organization_id", "name", "slug", "status", "version", "lifecycle_epoch", "authority_epoch", "workspaces", "departments", "teams", "groups"],
    properties: {
      organization_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"}, name: {type: "string"}, slug: {type: "string"}, status: {type: "string"},
      version: {type: "integer", minimum: 1}, lifecycle_epoch: {type: "integer", minimum: 0}, authority_epoch: {type: "integer", minimum: 0},
      workspaces: {type: "object"}, departments: {type: "object"}, teams: {type: "object"}, groups: {type: "object"},
    },
  },
  UserIdentityView: {
    type: "object", additionalProperties: false,
    required: ["user_id", "organization_id", "email", "display_name", "status", "version", "lifecycle_epoch", "authority_epoch", "roles", "devices", "delegations"],
    properties: {
      user_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"}, organization_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      email: {type: "string", format: "email"}, display_name: {type: "string"}, status: {type: "string", enum: ["ACTIVE", "DISABLED"]},
      version: {type: "integer", minimum: 1}, lifecycle_epoch: {type: "integer", minimum: 0}, authority_epoch: {type: "integer", minimum: 0},
      roles: {type: "object"}, devices: {type: "object"}, delegations: {type: "object"},
    },
  },
  ContextLinkView: {
    type: "object", additionalProperties: false,
    required: ["context_link_id", "organization_id", "source_ref", "target_ref", "relation_type", "strength", "metadata", "status", "version", "lifecycle_epoch", "authority_epoch"],
    properties: {
      context_link_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"}, organization_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      source_ref: {$ref: "#/components/schemas/SharedTypes/$defs/DomainObjectRef"}, target_ref: {$ref: "#/components/schemas/SharedTypes/$defs/DomainObjectRef"},
      relation_type: {type: "string"}, strength: {type: "string", enum: ["WEAK", "NORMAL", "STRONG", "CRITICAL"]}, metadata: {type: "object", additionalProperties: {type: "string"}},
      status: {type: "string", enum: ["ACTIVE", "ARCHIVED"]}, version: {type: "integer", minimum: 1}, lifecycle_epoch: {type: "integer", minimum: 0}, authority_epoch: {type: "integer", minimum: 0},
    },
  },
  MeetingView:{type:"object",additionalProperties:false,required:["meeting_id","organization_id","title","organizer_id","scheduled_start_at","timezone","status","version","lifecycle_epoch","authority_epoch","participants","decisions","action_items"],properties:{meeting_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},organization_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},title:{type:"string"},organizer_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},scheduled_start_at:{$ref:"#/components/schemas/SharedTypes/$defs/UtcInstant"},timezone:{type:"string"},status:{type:"string",enum:["SCHEDULED","IN_PROGRESS","ENDED","CANCELLED"]},started_at:{$ref:"#/components/schemas/SharedTypes/$defs/UtcInstant"},ended_at:{$ref:"#/components/schemas/SharedTypes/$defs/UtcInstant"},summary:{type:"string"},version:{type:"integer",minimum:1},lifecycle_epoch:{type:"integer",minimum:0},authority_epoch:{type:"integer",minimum:0},participants:{type:"object"},decisions:{type:"object"},action_items:{type:"object"}}},
  ConversationView:{type:"object",additionalProperties:false,required:["conversation_id","organization_id","title","creator_id","status","version","lifecycle_epoch","authority_epoch","members","messages"],properties:{conversation_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},organization_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},title:{type:"string"},creator_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},topic_ref:{$ref:"#/components/schemas/SharedTypes/$defs/DomainObjectRef"},status:{type:"string",enum:["ACTIVE","ARCHIVED"]},version:{type:"integer",minimum:1},lifecycle_epoch:{type:"integer",minimum:0},authority_epoch:{type:"integer",minimum:0},members:{type:"object"},messages:{type:"object"}}},
  FileAssetView:{type:"object",additionalProperties:false,required:["file_id","organization_id","name","media_type","owner_id","status","version","lifecycle_epoch","authority_epoch","uploads","versions","access"],properties:{file_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},organization_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},name:{type:"string"},media_type:{type:"string"},owner_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},status:{type:"string",enum:["DRAFT","AVAILABLE","QUARANTINED","ARCHIVED"]},version:{type:"integer",minimum:1},lifecycle_epoch:{type:"integer",minimum:0},authority_epoch:{type:"integer",minimum:0},uploads:{type:"object"},versions:{type:"object"},access:{type:"object"}}},
  ApprovalView:{type:"object",additionalProperties:false,required:["approval_id","organization_id","title","subject_ref","requester_id","required_approvals","status","version","lifecycle_epoch","authority_epoch","approvers","escalations"],properties:{approval_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},organization_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},title:{type:"string"},subject_ref:{$ref:"#/components/schemas/SharedTypes/$defs/DomainObjectRef"},requester_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},required_approvals:{type:"integer",minimum:1},status:{type:"string",enum:["PENDING","APPROVED","REJECTED","CHANGES_REQUESTED","CANCELLED","REVERSED"]},version:{type:"integer",minimum:1},lifecycle_epoch:{type:"integer",minimum:0},authority_epoch:{type:"integer",minimum:0},approvers:{type:"object"},escalations:{type:"array",items:{type:"object"}}}},
  CapacityProfileView:{type:"object",additionalProperties:false,required:["capacity_profile_id","organization_id","name","resource_ref","unit","status","version","lifecycle_epoch","authority_epoch","availability","allocations","snapshots","totals"],properties:{capacity_profile_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},organization_id:{$ref:"#/components/schemas/SharedTypes/$defs/UuidV7"},name:{type:"string"},resource_ref:{$ref:"#/components/schemas/SharedTypes/$defs/DomainObjectRef"},unit:{type:"string",enum:["HOURS","POINTS","PERCENT"]},status:{type:"string",enum:["ACTIVE","ARCHIVED"]},version:{type:"integer",minimum:1},lifecycle_epoch:{type:"integer",minimum:0},authority_epoch:{type:"integer",minimum:0},availability:{type:"object"},allocations:{type:"object"},snapshots:{type:"object"},totals:{type:"object"},calculated_at:{$ref:"#/components/schemas/SharedTypes/$defs/UtcInstant"}}},
};

const contractSchemas: JsonObject = {
  SharedTypes: bundled(readSchema("shared/types.schema.json")),
  CommandEnvelope: bundled(readSchema("shared/command-envelope.schema.json")),
  EventEnvelope: bundled(readSchema("shared/event-envelope.schema.json")),
};
for (const route of IMPLEMENTED_COMMAND_ROUTES) {
  contractSchemas[route.command] = contractSchema("commands", route.context, route.command);
  contractSchemas[route.event] = contractSchema("events", route.context, route.event);
}

function errorResponse(description: string): JsonObject {
  return {description, content: jsonContent({$ref: "#/components/schemas/Error"})};
}

function retryableErrorResponse(description: string): JsonObject {
  return {
    ...errorResponse(description),
    headers: {
      "Retry-After": {description: "Minimum retry delay in seconds", schema: {type: "integer", minimum: 1}},
      "X-RateLimit-Remaining": {description: "Remaining tokens in the current local bucket", schema: {type: "integer", minimum: 0}},
    },
  };
}

export const OPENAPI_DOCUMENT: JsonObject = {
  openapi: "3.1.2",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: {
    title: "ONYX IFEM API",
    version: "0.1.0",
    description: "Executable HTTP surface for the ONYX IFEM v2.0 field-complete contract baseline.",
  },
  servers: [{url: "http://127.0.0.1:3000"}],
  tags: ["mission", "work", "timeline", "reporting-evidence", "operations"].map((name) => ({name})),
  paths,
  components: {
    schemas: {
      ...contractSchemas,
      ...viewSchemas,
      Error: {
        type: "object", additionalProperties: false, required: ["code", "message"],
        properties: {code: {type: "string"}, message: {type: "string"}, details: {type: "object"}},
      },
    },
    parameters: {
      OrganizationId: {
        name: "organization_id", in: "query", required: true,
        schema: {type: "string", pattern: UUID_PATTERN},
      },
      ObjectId: {name: "id", in: "path", required: true, schema: {type: "string", pattern: UUID_PATTERN}},
      Cursor: {name: "cursor", in: "query", schema: {type: "string", minLength: 1, maxLength: 128}},
      AfterVersion: {name: "after_version", in: "query", schema: {type: "integer", minimum: 0, default: 0}},
      Limit: {name: "limit", in: "query", schema: {type: "integer", minimum: 1, maximum: 1000, default: 100}},
    },
    responses: {
      Error400: errorResponse("Invalid request"), Error401: errorResponse("Authentication required or token invalid"),
      Error403: errorResponse("Authority or organization denied"),
      Error404: errorResponse("Resource not found"), Error409: errorResponse("Version or lifecycle conflict"),
      Error422: errorResponse("Idempotency or invariant violation"),
      Error429: retryableErrorResponse("Request rate limit exceeded"),
      Error500: errorResponse("Internal failure"),
      Error503: retryableErrorResponse("Server capacity or dependency unavailable"),
    },
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT (EdDSA/Ed25519)",
        description: "ONYX access token with typ=onyx-access+jwt. Required when ONYX_AUTH_MODE=required.",
      },
    },
  },
};
