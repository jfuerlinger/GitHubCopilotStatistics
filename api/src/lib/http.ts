import type { HttpResponseInit } from "@azure/functions";

export function json(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" }
  };
}
