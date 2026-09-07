import type { UsageEntity } from "./types.js";

export interface ReportRow {
  month: string;
  actor: string;
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  githubAiCredits: number;
}

export function aggregateUsage(entities: UsageEntity[]): ReportRow[] {
  const groups = new Map<string, ReportRow & { sessionIds: Set<string> }>();
  for (const entity of entities) {
    const key = `${entity.month}\0${entity.actor}\0${entity.model}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        month: entity.month, actor: entity.actor, model: entity.model, sessions: 0,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        reasoningTokens: 0, githubAiCredits: 0, sessionIds: new Set<string>()
      };
      groups.set(key, group);
    }
    group.sessionIds.add(entity.sessionId);
    group.inputTokens += entity.inputTokens;
    group.outputTokens += entity.outputTokens;
    group.cacheReadTokens += entity.cacheReadTokens;
    group.cacheWriteTokens += entity.cacheWriteTokens;
    group.reasoningTokens += entity.reasoningTokens;
    group.githubAiCredits += entity.githubAiCredits;
  }
  return [...groups.values()].map(({ sessionIds, ...row }) => ({
    ...row,
    sessions: sessionIds.size,
    githubAiCredits: Math.round(row.githubAiCredits * 100) / 100
  })).sort((a, b) => a.month.localeCompare(b.month) || a.actor.localeCompare(b.actor) || a.model.localeCompare(b.model));
}
