const API_ORIGIN = process.env.ONYX_API_URL || "http://127.0.0.1:3001";
const ALLOWED_PREFIXES = ["/healthz", "/readyz", "/openapi.json", "/v1/"];

function target(request: Request) {
  const requestUrl = new URL(request.url);
  const path = requestUrl.searchParams.get("path") || "";
  if (!path.startsWith("/") || !ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))) {
    throw new Error("Unsupported ONYX API path");
  }
  return new URL(path, API_ORIGIN);
}

async function proxy(request: Request) {
  try {
    const upstream = await fetch(target(request), {
      method: request.method,
      headers: request.method === "POST" ? { "content-type": "application/json" } : undefined,
      body: request.method === "POST" ? await request.text() : undefined,
      cache: "no-store",
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({ code: "DEPENDENCY_UNAVAILABLE", message: error instanceof Error ? error.message : "ONYX API unavailable" }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
