import { TableClient, TableServiceClient, odata } from "@azure/data-tables";
import type { UsageRequest, UsageEntity } from "./types.js";
import { monthFromTimestamp, normalizeRepository, repositoryKey } from "./validation.js";

const usageTable = "CopilotUsage";
const repositoriesTable = "CopilotRepositories";
let initialized: Promise<void> | undefined;

function connectionString(): string {
  const value = process.env.USAGE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
  if (!value) throw new Error("USAGE_STORAGE_CONNECTION_STRING is not configured");
  return value;
}

function clients() {
  const connection = connectionString();
  return {
    usage: TableClient.fromConnectionString(connection, usageTable),
    repositories: TableClient.fromConnectionString(connection, repositoriesTable)
  };
}

async function initialize(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const service = TableServiceClient.fromConnectionString(connectionString());
      for (const table of [usageTable, repositoriesTable]) {
        try { await service.createTable(table); }
        catch (error: unknown) {
          if (!(typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 409)) throw error;
        }
      }
    })().catch((error) => { initialized = undefined; throw error; });
  }
  await initialized;
}

function rowKey(sessionId: string, model: string): string {
  return `${sessionId}:${model}`.replace(/[\\/#?]/g, "_");
}

export async function saveUsage(request: UsageRequest, actor: string): Promise<{ repository: string; models: number }> {
  await initialize();
  const { usage, repositories } = clients();
  const repository = normalizeRepository(request);
  const partitionKey = repositoryKey(repository);
  const models = request.usage.by_model?.length
    ? request.usage.by_model
    : [{ model: "all", ...request.usage.tokens }];

  await repositories.upsertEntity({
    partitionKey: "repositories", rowKey: partitionKey, repository,
    root: request.repository.root || "", lastCapturedAt: request.interaction.captured_at
  }, "Merge");

  await Promise.all(models.map((tokens) => usage.upsertEntity<UsageEntity>({
    partitionKey,
    rowKey: rowKey(request.session.id, tokens.model),
    sessionId: request.session.id,
    capturedAt: request.interaction.captured_at,
    month: monthFromTimestamp(request.interaction.captured_at),
    actor,
    model: tokens.model,
    repository,
    branch: request.repository.branch || "",
    commit: request.repository.commit || "",
    source: request.usage.source || "unknown",
    stopReason: request.interaction.stop_reason || "",
    inputTokens: tokens.input_tokens,
    outputTokens: tokens.output_tokens,
    cacheReadTokens: tokens.cache_read_tokens,
    cacheWriteTokens: tokens.cache_write_tokens,
    reasoningTokens: tokens.reasoning_tokens,
    githubAiCredits: tokens.github_ai_credits
  }, "Replace")));
  return { repository, models: models.length };
}

export async function listRepositories(): Promise<Array<{ id: string; repository: string; lastCapturedAt: number }>> {
  await initialize();
  const { repositories } = clients();
  const result = [];
  for await (const entity of repositories.listEntities<{ repository: string; lastCapturedAt: number }>({ queryOptions: { filter: odata`PartitionKey eq ${"repositories"}` } })) {
    result.push({ id: entity.rowKey!, repository: entity.repository, lastCapturedAt: entity.lastCapturedAt });
  }
  return result.sort((a, b) => a.repository.localeCompare(b.repository));
}

export async function queryUsage(repository: string, from: string, to: string): Promise<UsageEntity[]> {
  await initialize();
  const { usage } = clients();
  const partitionKey = repositoryKey(repository.replace(/\.git$/i, "").replace(/\/$/, ""));
  const result: UsageEntity[] = [];
  const filter = odata`PartitionKey eq ${partitionKey} and month ge ${from} and month le ${to}`;
  for await (const entity of usage.listEntities<UsageEntity>({ queryOptions: { filter } })) result.push(entity);
  return result;
}
