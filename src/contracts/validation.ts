import { OnyxError } from "./errors.ts";
import { sha256 } from "../shared/canonical-json.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const COMMAND_KEYS = new Set([
  "command_id",
  "operation_id",
  "command_type",
  "schema_version",
  "organization_id",
  "target",
  "expected_version",
  "expected_lifecycle_epoch",
  "expected_authority_epoch",
  "actor_context",
  "authority_proof",
  "issued_at",
  "vector_clock",
  "correlation_id",
  "causation_id",
  "payload",
]);
const EVENT_KEYS = new Set([
  "event_id",
  "event_type",
  "schema_version",
  "organization_id",
  "aggregate",
  "aggregate_version",
  "lifecycle_epoch",
  "authority_epoch",
  "operation_id",
  "actor_context",
  "occurred_at",
  "recorded_at",
  "vector_clock",
  "correlation_id",
  "causation_id",
  "audit",
  "payload",
]);
const DOMAIN_OBJECT_REF_KEYS = new Set(["aggregate_type", "object_id"]);
const ACTOR_CONTEXT_KEYS = new Set(["principal_id", "actor_type", "device_id", "membership_id"]);
const AUTHORITY_PROOF_KEYS = new Set(["proof_ref", "scope", "expires_at", "authority_epoch"]);
const AUDIT_KEYS = new Set(["provenance", "integrity_digest"]);
const ACTOR_TYPES = new Set(["USER", "SERVICE", "DEVICE"]);
const SHA_256 = /^[0-9a-f]{64}$/;

export function fail(message: string, details?: Record<string, unknown>): never {
  throw new OnyxError("INVALID_ARGUMENT", message, details);
}

export function object(value: unknown, field: string): Record<string, any> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value as Record<string, any>;
}

export function exactKeys(value: Record<string, unknown>, allowed: Iterable<string>, field: string): void {
  const allowedSet = allowed instanceof Set ? allowed : new Set(allowed);
  const unknownKeys = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknownKeys.length > 0) fail(`${field} contains unknown fields`, {unknownKeys});
}

export function uuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_V7.test(value)) fail(`${field} must be a canonical UUIDv7`);
}

export function text(value: unknown, field: string, max?: number): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || (max !== undefined && value.length > max)) {
    fail(`${field} must contain 1${max ? ` to ${max}` : " or more"} characters`);
  }
}

export function validateDomainObjectRef(value: unknown, field: string): Record<string, any> {
  const reference = object(value, field);
  exactKeys(reference, DOMAIN_OBJECT_REF_KEYS, field);
  text(reference.aggregate_type, `${field}.aggregate_type`);
  uuid(reference.object_id, `${field}.object_id`);
  return reference;
}

function nonNegativeInteger(value: unknown, field: string): void {
  if (!Number.isInteger(value) || (value as number) < 0) fail(`${field} must be a non-negative integer`);
}

function instant(value: unknown, field: string): void {
  if (typeof value !== "string" || !UTC_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    fail(`${field} must be a canonical UTC instant`);
  }
}

function validateActorContext(value: unknown): void {
  const actor = object(value, "actor_context");
  exactKeys(actor, ACTOR_CONTEXT_KEYS, "actor_context");
  uuid(actor.principal_id, "actor_context.principal_id");
  if (!ACTOR_TYPES.has(actor.actor_type)) fail("actor_context.actor_type is invalid");
  if (actor.device_id !== undefined) uuid(actor.device_id, "actor_context.device_id");
  if (actor.membership_id !== undefined) uuid(actor.membership_id, "actor_context.membership_id");
}

function validateVectorClock(value: unknown): void {
  const vectorClock = object(value, "vector_clock");
  for (const [replica, counter] of Object.entries(vectorClock)) {
    if (!Number.isInteger(counter) || (counter as number) < 1) fail(`vector_clock.${replica} must be a positive integer`);
  }
}

export function validateCommandEnvelope(value: unknown, commandType: string, aggregateType: string): Record<string, any> {
  const command = object(value, "command");
  exactKeys(command, COMMAND_KEYS, "command");
  if (command.command_type !== commandType || command.schema_version !== 1) fail("unsupported command type or schema version");
  for (const field of ["command_id", "operation_id", "organization_id", "correlation_id"]) uuid(command[field], field);
  if (command.causation_id !== undefined) uuid(command.causation_id, "causation_id");
  for (const field of ["expected_version", "expected_lifecycle_epoch", "expected_authority_epoch"]) {
    if (command[field] !== undefined) nonNegativeInteger(command[field], field);
  }

  const target = validateDomainObjectRef(command.target, "target");
  if (target.aggregate_type !== aggregateType) fail(`target.aggregate_type must be ${aggregateType}`);

  validateActorContext(command.actor_context);

  const proof = object(command.authority_proof, "authority_proof");
  exactKeys(proof, AUTHORITY_PROOF_KEYS, "authority_proof");
  text(proof.proof_ref, "authority_proof.proof_ref");
  if (!Array.isArray(proof.scope) || proof.scope.length === 0) fail("authority_proof.scope must not be empty");
  if (proof.scope.some((scope: unknown) => typeof scope !== "string" || scope.length < 1)) {
    fail("authority_proof.scope entries must not be empty");
  }
  if (new Set(proof.scope).size !== proof.scope.length) fail("authority_proof.scope entries must be unique");
  instant(proof.expires_at, "authority_proof.expires_at");
  nonNegativeInteger(proof.authority_epoch, "authority_proof.authority_epoch");

  instant(command.issued_at, "issued_at");
  validateVectorClock(command.vector_clock);
  object(command.payload, "payload");
  return command;
}

export function validateEventEnvelope(value: unknown, eventType: string, aggregateType: string): Record<string, any> {
  const event = object(value, "event");
  exactKeys(event, EVENT_KEYS, "event");
  if (event.event_type !== eventType || event.schema_version !== 1) fail("unsupported event type or schema version");
  for (const field of ["event_id", "organization_id", "operation_id", "correlation_id"]) uuid(event[field], field);
  if (event.causation_id !== undefined) uuid(event.causation_id, "causation_id");

  const aggregate = validateDomainObjectRef(event.aggregate, "aggregate");
  if (aggregate.aggregate_type !== aggregateType) fail(`aggregate.aggregate_type must be ${aggregateType}`);
  for (const field of ["aggregate_version", "lifecycle_epoch", "authority_epoch"]) nonNegativeInteger(event[field], field);

  validateActorContext(event.actor_context);
  instant(event.occurred_at, "occurred_at");
  instant(event.recorded_at, "recorded_at");
  validateVectorClock(event.vector_clock);

  const audit = object(event.audit, "audit");
  exactKeys(audit, AUDIT_KEYS, "audit");
  text(audit.provenance, "audit.provenance");
  if (typeof audit.integrity_digest !== "string" || !SHA_256.test(audit.integrity_digest)) {
    fail("audit.integrity_digest must be a lowercase SHA-256 digest");
  }
  const {audit: _audit, ...unsignedEvent} = event;
  if (audit.integrity_digest !== sha256(unsignedEvent)) fail("audit.integrity_digest does not match event content");
  object(event.payload, "payload");
  return event;
}

export function assertEmittedEvent(value: unknown, eventType: string, aggregateType: string): void {
  try {
    validateEventEnvelope(value, eventType, aggregateType);
  } catch (error) {
    throw new Error(`emitted ${eventType} event violates the canonical contract`, {cause: error});
  }
}
