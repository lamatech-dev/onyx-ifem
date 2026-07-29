import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, any>;

interface CommandRoute {
  context: "mission" | "work" | "timeline" | "reporting-evidence";
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
  {context: "mission", command: "CancelMission", event: "MissionCancelled"},
  {context: "mission", command: "ArchiveMission", event: "MissionArchived"},
  {context: "work", command: "CreateTask", event: "TaskCreated"},
  {context: "timeline", command: "CreateTimeline", event: "TimelineCreated"},
  {context: "reporting-evidence", command: "CreateReport", event: "ReportCreated"},
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
  ["400", "401", "403", "404", "409", "422", "500"].map((status) => [status, {$ref: `#/components/responses/Error${status}`}]),
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
  "500": {$ref: "#/components/responses/Error500"},
};

function addResource(resource: string, singular: string, schema: string, events: string[]): void {
  const tag = singular.toLowerCase();
  paths[`/v1/${resource}`] = {
    get: {
      operationId: `list${singular}s`,
      tags: [tag],
      security: [{BearerAuth: []}],
      parameters: [organizationParameter],
      responses: {
        "200": {
          description: `${singular} collection`,
          content: jsonContent({
            type: "object",
            additionalProperties: false,
            required: ["items"],
            properties: {items: {type: "array", items: {$ref: `#/components/schemas/${schema}`}}},
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
addResource("tasks", "Task", "TaskView", ["TaskCreated"]);
addResource("timelines", "Timeline", "TimelineView", ["TimelineCreated"]);
addResource("reports", "Report", "ReportView", ["ReportCreated"]);

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

paths["/openapi.json"] = {
  get: {
    operationId: "getOpenApi",
    tags: ["operations"],
    responses: {"200": {description: "OpenAPI 3.1 description", content: jsonContent({type: "object"})}},
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
    required: ["task_id", "organization_id", "mission_id", "title", "description", "owner_id", "priority", "status", "version"],
    properties: {
      task_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      organization_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      mission_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      title: {type: "string"}, description: {type: "string"},
      owner_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      priority: {type: "string"}, status: {type: "string"}, version: {type: "integer", minimum: 1},
    },
  },
  TimelineView: {
    type: "object", additionalProperties: false,
    required: ["timeline_id", "organization_id", "subject_ref", "timezone", "version"],
    properties: {
      timeline_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      organization_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      subject_ref: {$ref: "#/components/schemas/SharedTypes/$defs/DomainObjectRef"},
      timezone: {type: "string", minLength: 1}, version: {type: "integer", minimum: 1},
    },
  },
  ReportView: {
    type: "object", additionalProperties: false,
    required: ["report_id", "organization_id", "report_type", "subject_ref", "author_id", "title", "version"],
    properties: {
      report_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      organization_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"}, report_type: {type: "string"},
      subject_ref: {$ref: "#/components/schemas/SharedTypes/$defs/DomainObjectRef"},
      author_id: {$ref: "#/components/schemas/SharedTypes/$defs/UuidV7"},
      title: {type: "string", minLength: 1}, version: {type: "integer", minimum: 1},
    },
  },
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
      AfterVersion: {name: "after_version", in: "query", schema: {type: "integer", minimum: 0, default: 0}},
      Limit: {name: "limit", in: "query", schema: {type: "integer", minimum: 1, maximum: 1000, default: 100}},
    },
    responses: {
      Error400: errorResponse("Invalid request"), Error401: errorResponse("Authentication required or token invalid"),
      Error403: errorResponse("Authority or organization denied"),
      Error404: errorResponse("Resource not found"), Error409: errorResponse("Version or lifecycle conflict"),
      Error422: errorResponse("Idempotency or invariant violation"), Error500: errorResponse("Internal failure"),
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
