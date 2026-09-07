import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { json } from "../lib/http.js";
import { listRepositories } from "../lib/storage.js";

export async function repositoriesHandler(_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try { return json(200, { repositories: await listRepositories() }); }
  catch (error) {
    context.error("Failed to list repositories", error);
    return json(500, { error: "Failed to list repositories" });
  }
}

app.http("repositories", {
  methods: ["GET"], authLevel: "anonymous", route: "repositories", handler: repositoriesHandler
});
