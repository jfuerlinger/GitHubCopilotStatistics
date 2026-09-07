import { createHash } from "node:crypto";
import type { TokenUsage, UsageRequest } from "./types.js";

const tokenKeys: Array<keyof TokenUsage> = [
  "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
  "reasoning_tokens", "github_ai_credits"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTokens(value: unknown): value is TokenUsage {
  return isRecord(value) && tokenKeys.every((key) =>
    typeof value[key] === "number" && Number.isFinite(value[key]) && (value[key] as number) >= 0
  );
}

export function parseUsageRequest(value: unknown): UsageRequest {
  if (!isRecord(value) || value.event !== "copilot.agent_stop") throw new Error("Unsupported or missing event");
  const session = value.session;
  const interaction = value.interaction;
  const repository = value.repository;
  const usage = value.usage;
  if (!isRecord(session) || typeof session.id !== "string" || !session.id.trim()) throw new Error("session.id is required");
  if (!isRecord(interaction) || typeof interaction.captured_at !== "number" || !Number.isFinite(interaction.captured_at)) throw new Error("interaction.captured_at is required");
  if (!isRecord(repository) || (![repository.remote_origin, repository.root].some((item) => typeof item === "string" && item.trim()))) throw new Error("repository.remote_origin or repository.root is required");
  if (!isRecord(usage) || !validTokens(usage.tokens)) throw new Error("usage.tokens is invalid");
  if (usage.by_model !== undefined && (!Array.isArray(usage.by_model) || !usage.by_model.every((item) => isRecord(item) && typeof item.model === "string" && item.model.trim() && validTokens(item)))) throw new Error("usage.by_model is invalid");
  return value as unknown as UsageRequest;
}

export function normalizeRepository(request: UsageRequest): string {
  const value = request.repository.remote_origin || request.repository.root || "unknown";
  return value.trim().replace(/\.git$/i, "").replace(/\/$/, "");
}

export function repositoryKey(repository: string): string {
  return createHash("sha256").update(repository.toLowerCase()).digest("hex").slice(0, 32);
}

export function resolveActor(request: UsageRequest, queryActor?: string | null, headerActor?: string | null): string {
  if (typeof request.actor === "string" && request.actor.trim()) return request.actor.trim();
  if (request.actor && typeof request.actor === "object") {
    const actor = request.actor.login || request.actor.name || request.actor.id;
    if (actor?.trim()) return actor.trim();
  }
  return queryActor?.trim() || headerActor?.trim() || "unknown";
}

export function monthFromTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) throw new Error("interaction.captured_at is invalid");
  return date.toISOString().slice(0, 7);
}

export function validMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
