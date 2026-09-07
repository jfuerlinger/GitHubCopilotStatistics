import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { json } from "../lib/http.js";
import { saveUsage } from "../lib/storage.js";
import { parseUsageRequest, resolveActor } from "../lib/validation.js";

export async function ingestUsage(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const expectedKey = process.env.INGESTION_KEY;
  const suppliedKey = request.query.get("key") || request.headers.get("x-ingestion-key");
  if (!expectedKey) {
    context.error("INGESTION_KEY is not configured");
    return json(503, { error: "Ingestion is not configured" });
  }
  if (suppliedKey !== expectedKey) return json(401, { error: "Unauthorized" });
  try {
    const body = parseUsageRequest(await request.json());
    const actor = resolveActor(body, request.query.get("actor"), request.headers.get("x-copilot-actor"));
    const saved = await saveUsage(body, actor);
    return json(202, { accepted: true, actor, ...saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    if (message.includes("required") || message.includes("invalid") || message.includes("Unsupported")) return json(400, { error: message });
    context.error("Failed to persist Copilot usage", error);
    return json(500, { error: "Failed to persist usage" });
  }
}

app.http("ingestUsage", {
  methods: ["POST"], authLevel: "anonymous", route: "usage", handler: ingestUsage
});
