import type { CommandEnvelope, DomainObjectRef, EventEnvelope, UuidV7 } from "../contracts/envelopes.ts";
export type ContextStrength = "WEAK" | "NORMAL" | "STRONG" | "CRITICAL";
export interface CreateContextLinkPayload { context_link_id: UuidV7; source_ref: DomainObjectRef; target_ref: DomainObjectRef; relation_type: string; strength: ContextStrength; metadata: Record<string, string> }
export interface UpdateContextMetadataPayload { context_link_id: UuidV7; metadata: Record<string, string> }
export interface ChangeContextStrengthPayload { context_link_id: UuidV7; strength: ContextStrength; reason: string }
export interface ArchiveContextLinkPayload { context_link_id: UuidV7; reason: string }
export interface RestoreContextLinkPayload { context_link_id: UuidV7; reason: string }
export type ContextLinkCommand = CommandEnvelope<"CreateContextLink", CreateContextLinkPayload> | CommandEnvelope<"UpdateContextMetadata", UpdateContextMetadataPayload> | CommandEnvelope<"ChangeContextStrength", ChangeContextStrengthPayload> | CommandEnvelope<"ArchiveContextLink", ArchiveContextLinkPayload> | CommandEnvelope<"RestoreContextLink", RestoreContextLinkPayload>;
export type ContextLinkEvent = EventEnvelope<"ContextLinkCreated", CreateContextLinkPayload> | EventEnvelope<"ContextMetadataUpdated", UpdateContextMetadataPayload> | EventEnvelope<"ContextStrengthChanged", ChangeContextStrengthPayload> | EventEnvelope<"ContextLinkArchived", ArchiveContextLinkPayload> | EventEnvelope<"ContextLinkRestored", RestoreContextLinkPayload>;
export interface ContextLink { contextLinkId: UuidV7; organizationId: UuidV7; sourceRef: DomainObjectRef; targetRef: DomainObjectRef; relationType: string; strength: ContextStrength; metadata: Record<string, string>; status: "ACTIVE" | "ARCHIVED"; version: number; lifecycleEpoch: number; authorityEpoch: number }
export interface ContextLinkView { context_link_id: UuidV7; organization_id: UuidV7; source_ref: DomainObjectRef; target_ref: DomainObjectRef; relation_type: string; strength: ContextStrength; metadata: Record<string, string>; status: "ACTIVE" | "ARCHIVED"; version: number; lifecycle_epoch: number; authority_epoch: number }
