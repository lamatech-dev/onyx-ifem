export type OnyxErrorCode =
  | "INVALID_ARGUMENT"
  | "AUTHENTICATION_REQUIRED"
  | "AUTHORITY_PROOF_INVALID"
  | "ORGANIZATION_MISMATCH"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "LIFECYCLE_EPOCH_MISMATCH"
  | "AUTHORITY_EPOCH_MISMATCH"
  | "INVALID_STATE_TRANSITION"
  | "IDEMPOTENCY_KEY_REUSE"
  | "RATE_LIMITED"
  | "DEPENDENCY_UNAVAILABLE"
  | "DEADLINE_EXCEEDED"
  | "INTERNAL_ERROR";

const HTTP_STATUS: Record<OnyxErrorCode, number> = {
  INVALID_ARGUMENT: 400,
  AUTHENTICATION_REQUIRED: 401,
  AUTHORITY_PROOF_INVALID: 403,
  ORGANIZATION_MISMATCH: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  LIFECYCLE_EPOCH_MISMATCH: 409,
  AUTHORITY_EPOCH_MISMATCH: 409,
  INVALID_STATE_TRANSITION: 409,
  IDEMPOTENCY_KEY_REUSE: 422,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  DEADLINE_EXCEEDED: 504,
  INTERNAL_ERROR: 500,
};

export class OnyxError extends Error {
  readonly code: OnyxErrorCode;
  readonly httpStatus: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: OnyxErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "OnyxError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.details = details;
  }
}
