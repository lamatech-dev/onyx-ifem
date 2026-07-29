export type OnyxErrorCode =
  | "INVALID_ARGUMENT"
  | "AUTHORITY_PROOF_INVALID"
  | "ORGANIZATION_MISMATCH"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_KEY_REUSE"
  | "INTERNAL_ERROR";

const HTTP_STATUS: Record<OnyxErrorCode, number> = {
  INVALID_ARGUMENT: 400,
  AUTHORITY_PROOF_INVALID: 403,
  ORGANIZATION_MISMATCH: 403,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSE: 422,
  INTERNAL_ERROR: 500,
};

export class OnyxError extends Error {
  readonly code: OnyxErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: OnyxErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "OnyxError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.details = details;
  }
}

