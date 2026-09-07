import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCreditsByMonthAndRepository, aggregateUsage } from "../src/lib/reports.js";
import { monthFromTimestamp, normalizeRepository, parseUsageRequest, repositoryKey, resolveActor } from "../src/lib/validation.js";
import type { UsageEntity, UsageRequest } from "../src/lib/types.js";

const request: UsageRequest = {
  event: "copilot.agent_stop",
  session: { id: "session-1" },
  interaction: { captured_at: Date.UTC(2026, 8, 7) },
  repository: { remote_origin: "https://github.com/acme/app.git" },
  usage: { source: "session-store", tokens: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 4, reasoning_tokens: 1, github_ai_credits: 0.25 } }
};

test("validates and normalizes a payload", () => {
  assert.equal(parseUsageRequest(request), request);
  assert.equal(normalizeRepository(request), "https://github.com/acme/app");
  assert.equal(repositoryKey(normalizeRepository(request)).length, 32);
  assert.equal(monthFromTimestamp(request.interaction.captured_at), "2026-09");
  assert.equal(resolveActor(request, "joe", null), "joe");
});

test("rejects negative token counts", () => {
  const invalid = structuredClone(request);
  invalid.usage.tokens.input_tokens = -1;
  assert.throws(() => parseUsageRequest(invalid), /invalid/);
});

test("aggregates by month, actor and model", () => {
  const base: UsageEntity = {
    partitionKey: "repo", rowKey: "1", sessionId: "s1", capturedAt: 1,
    month: "2026-09", actor: "joe", model: "gpt", repository: "repo", branch: "main",
    commit: "abc", source: "store", stopReason: "end_turn", inputTokens: 10,
    outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: 1,
    githubAiCredits: 0.255
  };
  const rows = aggregateUsage([base, { ...base, rowKey: "2", sessionId: "s2", inputTokens: 5, githubAiCredits: 0.255 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessions, 2);
  assert.equal(rows[0].inputTokens, 15);
  assert.equal(rows[0].githubAiCredits, 0.51);
});

test("aggregates AI credits by month and repository", () => {
  const rows = aggregateCreditsByMonthAndRepository([
    { partitionKey: "repo1", rowKey: "1", sessionId: "s1", capturedAt: 1, month: "2026-09", actor: "joe", model: "gpt", repository: "repo-a", branch: "main", commit: "a", source: "store", stopReason: "end_turn", inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, githubAiCredits: 0.25 },
    { partitionKey: "repo2", rowKey: "2", sessionId: "s2", capturedAt: 2, month: "2026-09", actor: "ann", model: "gpt", repository: "repo-b", branch: "main", commit: "b", source: "store", stopReason: "end_turn", inputTokens: 11, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, githubAiCredits: 0.35 },
    { partitionKey: "repo1", rowKey: "3", sessionId: "s3", capturedAt: 3, month: "2026-09", actor: "joe", model: "gpt", repository: "repo-a", branch: "main", commit: "a", source: "store", stopReason: "end_turn", inputTokens: 12, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, githubAiCredits: 0.15 }
  ]);
  assert.deepEqual(rows, [
    { month: "2026-09", repository: "repo-a", githubAiCredits: 0.4 },
    { month: "2026-09", repository: "repo-b", githubAiCredits: 0.35 }
  ]);
});
