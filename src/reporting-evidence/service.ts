import type { DomainObjectRef } from "../contracts/envelopes.ts";
import { OnyxError } from "../contracts/errors.ts";
import { assertEmittedEvent } from "../contracts/validation.ts";
import { sha256 } from "../shared/canonical-json.ts";
import { utcInstant, uuidV7 } from "../shared/identifiers.ts";
import { toReportView, type ReportingRepository } from "./repository.ts";
import type { Report, ReportCreatedEvent, ReportView } from "./types.ts";
import { validateCreateReportCommand } from "./validation.ts";

export interface ReportingServiceOptions {
  repository: ReportingRepository;
  requireSubject: (organizationId: string, subject: DomainObjectRef) => Promise<void>;
  now?: () => Date;
  replicaId?: string;
}

export class ReportingService {
  readonly #repository: ReportingRepository;
  readonly #requireSubject: ReportingServiceOptions["requireSubject"];
  readonly #now: () => Date;
  readonly #replicaId: string;

  constructor(options: ReportingServiceOptions) {
    this.#repository = options.repository;
    this.#requireSubject = options.requireSubject;
    this.#now = options.now ?? (() => new Date());
    this.#replicaId = options.replicaId ?? "reporting-evidence-service";
  }

  async execute(input: unknown): Promise<ReportCreatedEvent> {
    if ((input as {command_type?: string})?.command_type !== "CreateReport") {
      throw new OnyxError("INVALID_ARGUMENT", "command is not implemented because its payload is not frozen");
    }
    return this.createReport(input);
  }

  async createReport(input: unknown): Promise<ReportCreatedEvent> {
    validateCreateReportCommand(input);
    const command = input;
    const fingerprint = sha256(command);
    const prior = await this.#repository.findOperation(command.operation_id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new OnyxError("IDEMPOTENCY_KEY_REUSE", "operation_id was reused with a different command");
      return structuredClone(prior.event);
    }
    if (!command.authority_proof.scope.includes("reporting-evidence:create") || Date.parse(command.authority_proof.expires_at) <= this.#now().getTime()) {
      throw new OnyxError("AUTHORITY_PROOF_INVALID", "reporting-evidence:create authority is missing or expired");
    }
    if (command.expected_version !== undefined && command.expected_version !== 0) {
      throw new OnyxError("VERSION_CONFLICT", "a new report must expect version 0");
    }
    if (await this.#repository.find(command.payload.report_id)) throw new OnyxError("VERSION_CONFLICT", "report already exists");
    await this.#requireSubject(command.organization_id, command.payload.subject_ref);

    const report: Report = {
      reportId: command.payload.report_id,
      organizationId: command.organization_id,
      reportType: command.payload.report_type,
      subjectRef: structuredClone(command.payload.subject_ref),
      authorId: command.payload.author_id,
      title: command.payload.title,
      version: 1,
    };
    const now = this.#now();
    const occurredAt = utcInstant(now);
    const eventWithoutDigest = {
      event_id: uuidV7(now),
      event_type: "ReportCreated" as const,
      schema_version: 1 as const,
      organization_id: command.organization_id,
      aggregate: {aggregate_type: "Report", object_id: command.payload.report_id},
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
    const event: ReportCreatedEvent = {
      ...eventWithoutDigest,
      audit: {provenance: "CreateReport@1", integrity_digest: sha256(eventWithoutDigest)},
    };
    assertEmittedEvent(event, "ReportCreated", "Report");
    await this.#repository.commit(report, event, command.operation_id, {fingerprint, event});
    return structuredClone(event);
  }

  async getReport(organizationId: string, reportId: string): Promise<ReportView> {
    const report = await this.#repository.find(reportId);
    if (!report || report.organizationId !== organizationId) throw new OnyxError("NOT_FOUND", "report not found");
    return toReportView(report);
  }

  async listReports(organizationId: string): Promise<ReportView[]> {
    return (await this.#repository.list(organizationId)).map(toReportView);
  }

  async getHistory(organizationId: string, reportId: string, afterVersion = 0, limit = 100): Promise<ReportCreatedEvent[]> {
    await this.getReport(organizationId, reportId);
    if (!Number.isInteger(afterVersion) || afterVersion < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new OnyxError("INVALID_ARGUMENT", "history bounds are invalid");
    }
    return this.#repository.history(reportId, afterVersion, limit);
  }
}
