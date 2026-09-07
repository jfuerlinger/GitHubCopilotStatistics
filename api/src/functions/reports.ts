import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { json } from "../lib/http.js";
import { aggregateUsage } from "../lib/reports.js";
import { queryUsage } from "../lib/storage.js";
import { validMonth } from "../lib/validation.js";

export async function monthlyReport(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const repository = request.query.get("repository")?.trim();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const from = request.query.get("from") || currentMonth;
  const to = request.query.get("to") || currentMonth;
  if (!repository || !validMonth(from) || !validMonth(to) || from > to) return json(400, { error: "repository and a valid month range are required" });
  try {
    const rows = aggregateUsage(await queryUsage(repository, from, to));
    return json(200, { repository, from, to, rows });
  } catch (error) {
    context.error("Failed to create monthly report", error);
    return json(500, { error: "Failed to create report" });
  }
}

app.http("monthlyReport", {
  methods: ["GET"], authLevel: "anonymous", route: "reports/monthly", handler: monthlyReport
});
