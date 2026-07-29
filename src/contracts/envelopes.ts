export type UuidV7 = string;
export type UtcInstant = string;
export type VectorClock = Record<string, number>;

export interface DomainObjectRef {
  aggregate_type: string;
  object_id: UuidV7;
}

export interface ActorContext {
  principal_id: UuidV7;
  actor_type: "USER" | "SERVICE" | "DEVICE";
  device_id?: UuidV7;
  membership_id?: UuidV7;
}

export interface AuthorityProof {
  proof_ref: string;
  scope: string[];
  expires_at: UtcInstant;
  authority_epoch: number;
}

export interface AuditMetadata {
  provenance: string;
  integrity_digest: string;
}

export interface CommandEnvelope<TType extends string, TPayload> {
  command_id: UuidV7;
  operation_id: UuidV7;
  command_type: TType;
  schema_version: 1;
  organization_id: UuidV7;
  target: DomainObjectRef;
  expected_version?: number;
  expected_lifecycle_epoch?: number;
  expected_authority_epoch?: number;
  actor_context: ActorContext;
  authority_proof: AuthorityProof;
  issued_at: UtcInstant;
  vector_clock: VectorClock;
  correlation_id: UuidV7;
  causation_id?: UuidV7;
  payload: TPayload;
}

export interface EventEnvelope<TType extends string, TPayload> {
  event_id: UuidV7;
  event_type: TType;
  schema_version: 1;
  organization_id: UuidV7;
  aggregate: DomainObjectRef;
  aggregate_version: number;
  lifecycle_epoch: number;
  authority_epoch: number;
  operation_id: UuidV7;
  actor_context: ActorContext;
  occurred_at: UtcInstant;
  recorded_at: UtcInstant;
  vector_clock: VectorClock;
  correlation_id: UuidV7;
  causation_id?: UuidV7;
  audit: AuditMetadata;
  payload: TPayload;
}

