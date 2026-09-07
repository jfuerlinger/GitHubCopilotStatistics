export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  github_ai_credits: number;
}

export interface UsageRequest {
  event: string;
  session: { id: string };
  interaction: { captured_at: number; stop_reason?: string };
  repository: {
    cwd?: string;
    root?: string;
    remote_origin?: string;
    branch?: string;
    commit?: string;
  };
  actor?: string | { login?: string; name?: string; id?: string };
  usage: {
    source?: string;
    tokens: TokenUsage;
    by_model?: Array<TokenUsage & { model: string }>;
  };
}

export interface UsageEntity {
  partitionKey: string;
  rowKey: string;
  sessionId: string;
  capturedAt: number;
  month: string;
  actor: string;
  model: string;
  repository: string;
  branch: string;
  commit: string;
  source: string;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  githubAiCredits: number;
}
