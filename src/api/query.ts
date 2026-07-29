import { OnyxError } from "../contracts/errors.ts";
import { uuid } from "../contracts/validation.ts";

export interface CollectionQuery {
  organizationId: string;
  afterId?: string;
  limit: number;
}

export interface HistoryQuery {
  organizationId: string;
  afterVersion: number;
  limit: number;
}

export function readCollectionQuery(url: URL): CollectionQuery {
  assertOnlyParameters(url, ["organization_id", "cursor", "limit"]);
  const organizationId = requiredUuid(url, "organization_id");
  const cursor = optionalParameter(url, "cursor");
  return {
    organizationId,
    ...(cursor !== undefined ? {afterId: decodeCursor(cursor)} : {}),
    limit: boundedInteger(url, "limit", 100, 1, 1_000),
  };
}

export function readItemQuery(url: URL, objectId: string): {organizationId: string} {
  assertOnlyParameters(url, ["organization_id"]);
  uuid(objectId, "id");
  return {organizationId: requiredUuid(url, "organization_id")};
}

export function readHistoryQuery(url: URL, objectId: string): HistoryQuery {
  assertOnlyParameters(url, ["organization_id", "after_version", "limit"]);
  uuid(objectId, "id");
  return {
    organizationId: requiredUuid(url, "organization_id"),
    afterVersion: boundedInteger(url, "after_version", 0, 0, Number.MAX_SAFE_INTEGER),
    limit: boundedInteger(url, "limit", 100, 1, 1_000),
  };
}

export function encodeCursor(objectId: string): string {
  uuid(objectId, "cursor object id");
  return Buffer.from(objectId, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  if (cursor.length > 128 || !/^[A-Za-z0-9_-]+$/.test(cursor)) invalid("cursor is invalid");
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (Buffer.from(decoded, "utf8").toString("base64url") !== cursor) invalid("cursor is invalid");
  uuid(decoded, "cursor");
  return decoded;
}

function assertOnlyParameters(url: URL, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const unknown = [...new Set(url.searchParams.keys())].filter((name) => !allowedSet.has(name));
  if (unknown.length > 0) invalid("query contains unknown parameters", {unknown});
  for (const name of allowed) {
    if (url.searchParams.getAll(name).length > 1) invalid(`${name} must appear at most once`);
  }
}

function requiredUuid(url: URL, name: string): string {
  const value = optionalParameter(url, name);
  if (value === undefined) invalid(`${name} is required`);
  uuid(value, name);
  return value;
}

function optionalParameter(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null ? undefined : value;
}

function boundedInteger(url: URL, name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = optionalParameter(url, name);
  if (raw === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(raw)) invalid(`${name} must be a canonical integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalid(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new OnyxError("INVALID_ARGUMENT", message, details);
}
