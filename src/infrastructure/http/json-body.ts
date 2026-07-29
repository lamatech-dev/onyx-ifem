import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { TextDecoder } from "node:util";
import { OnyxError } from "../../contracts/errors.ts";

const MAX_JSON_BYTES = 1_048_576;
const utf8 = new TextDecoder("utf-8", {fatal: true});

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  validateJsonRequestHeaders(request.headers);
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_JSON_BYTES) throw new OnyxError("INVALID_ARGUMENT", "command envelope exceeds 1 MiB");
    chunks.push(buffer);
  }

  let text: string;
  try {
    text = utf8.decode(Buffer.concat(chunks, length));
  } catch {
    throw new OnyxError("INVALID_ARGUMENT", "request body must be valid UTF-8");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new OnyxError("INVALID_ARGUMENT", "request body must be valid JSON");
  }
}

export function validateJsonRequestHeaders(headers: IncomingHttpHeaders): void {
  const encoding = singleHeader(headers["content-encoding"], "content-encoding");
  if (encoding !== undefined && encoding.trim().toLowerCase() !== "identity") {
    throw new OnyxError("INVALID_ARGUMENT", "content-encoding must be identity");
  }

  const contentType = singleHeader(headers["content-type"], "content-type");
  if (!contentType) throw new OnyxError("INVALID_ARGUMENT", "content-type application/json is required");
  const [mediaType = "", ...parameters] = contentType.split(";").map((part) => part.trim());
  if (mediaType.toLowerCase() !== "application/json") {
    throw new OnyxError("INVALID_ARGUMENT", "content-type must be application/json");
  }

  let charsetSeen = false;
  for (const parameter of parameters) {
    const separator = parameter.indexOf("=");
    if (separator < 1) throw new OnyxError("INVALID_ARGUMENT", "content-type parameters are invalid");
    const name = parameter.slice(0, separator).trim().toLowerCase();
    let value = parameter.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    if (name !== "charset" || charsetSeen || value.toLowerCase() !== "utf-8") {
      throw new OnyxError("INVALID_ARGUMENT", "content-type permits only one UTF-8 charset parameter");
    }
    charsetSeen = true;
  }
}

function singleHeader(value: string | string[] | undefined, name: string): string | undefined {
  if (Array.isArray(value)) throw new OnyxError("INVALID_ARGUMENT", `${name} must not be repeated`);
  return value;
}
