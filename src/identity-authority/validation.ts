import { exactKeys, fail, object, text, uuid, validateCommandEnvelope } from "../contracts/validation.ts";
import type { IdentityCommand } from "./types.ts";
const commands = new Set(["CreateUser", "AssignRole", "RevokeRole", "RegisterDevice", "RevokeDevice", "DelegateAuthority", "RevokeDelegation", "DisableUser", "EnableUser"]);
function payload(command: Record<string, any>, keys: string[]) { const value = object(command.payload, "payload"); exactKeys(value, keys, "payload"); uuid(value.user_id, "payload.user_id"); if (command.target.object_id !== value.user_id) fail("target object must match payload user_id"); return value; }
function instant(value: unknown, path: string) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(`${path} must be a UTC instant`); }
export function validateIdentityCommand(value: unknown): asserts value is IdentityCommand {
  const type = (value as {command_type?: string})?.command_type; if (typeof type !== "string" || !commands.has(type)) fail("command is not implemented");
  const command = validateCommandEnvelope(value, type, "User"), body = command as Record<string, any>; let data: Record<string, any>;
  switch (type) {
    case "CreateUser": data = payload(body, ["user_id", "email", "display_name"]); if (typeof data.email !== "string" || data.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail("payload.email is invalid"); text(data.display_name, "payload.display_name", 200); return;
    case "AssignRole": data = payload(body, ["user_id", "role_id"]); text(data.role_id, "payload.role_id", 120); return;
    case "RevokeRole": data = payload(body, ["user_id", "role_id", "reason"]); text(data.role_id, "payload.role_id", 120); text(data.reason, "payload.reason", 2000); return;
    case "RegisterDevice": data = payload(body, ["user_id", "device_id", "name", "public_key_thumbprint"]); uuid(data.device_id, "payload.device_id"); text(data.name, "payload.name", 200); if (typeof data.public_key_thumbprint !== "string" || !/^[a-f0-9]{64}$/.test(data.public_key_thumbprint)) fail("payload.public_key_thumbprint must be lowercase SHA-256 hex"); return;
    case "RevokeDevice": data = payload(body, ["user_id", "device_id", "reason"]); uuid(data.device_id, "payload.device_id"); text(data.reason, "payload.reason", 2000); return;
    case "DelegateAuthority": data = payload(body, ["user_id", "delegation_id", "delegatee_id", "scopes", "expires_at"]); uuid(data.delegation_id, "payload.delegation_id"); uuid(data.delegatee_id, "payload.delegatee_id"); if (!Array.isArray(data.scopes) || data.scopes.length < 1 || data.scopes.length > 100 || new Set(data.scopes).size !== data.scopes.length) fail("payload.scopes must contain unique scopes"); for (const scope of data.scopes) text(scope, "payload.scopes[]", 200); instant(data.expires_at, "payload.expires_at"); return;
    case "RevokeDelegation": data = payload(body, ["user_id", "delegation_id", "reason"]); uuid(data.delegation_id, "payload.delegation_id"); text(data.reason, "payload.reason", 2000); return;
    case "DisableUser": case "EnableUser": data = payload(body, ["user_id", "reason"]); text(data.reason, "payload.reason", 2000); return;
  }
}
