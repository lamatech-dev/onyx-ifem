const COMMAND_CONTEXTS = new Set(["mission", "work", "timeline", "reporting-evidence", "organization", "identity-authority", "context", "meeting", "communication"]);
const RESOURCE_NAMES = new Set(["missions", "tasks", "timelines", "reports", "organizations", "users", "context-links", "meetings", "conversations"]);

const READ_METHODS = ["GET", "HEAD"] as const;
const WRITE_METHODS = ["POST"] as const;

export function allowedMethodsForPath(pathname: string): readonly string[] | undefined {
  if (["/healthz", "/readyz", "/openapi.json", "/metrics"].includes(pathname)) return READ_METHODS;

  const commandMatch = pathname.match(/^\/v1\/([^/]+)\/commands\/[^/]+$/);
  if (commandMatch && COMMAND_CONTEXTS.has(commandMatch[1]!)) return WRITE_METHODS;

  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "v1" || !RESOURCE_NAMES.has(segments[1] ?? "")) return undefined;
  if (segments.length === 2 || segments.length === 3) return READ_METHODS;
  if (segments.length === 4 && segments[3] === "history") return READ_METHODS;
  return undefined;
}

export function acceptsJsonBody(method: string | undefined, pathname: string): boolean {
  return method === "POST" && allowedMethodsForPath(pathname) === WRITE_METHODS;
}
