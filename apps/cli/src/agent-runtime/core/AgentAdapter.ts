import type { AgentMessage, AgentSessionId } from './types';

export interface AgentInitOptions {
  cwd: string;
  env?: Record<string, string> | undefined;
  startupTimeoutMs?: number | undefined;
  defaultTimeoutMs?: number | undefined;
  gracefulShutdownMs?: number | undefined;
}

export interface SubmitPromptOptions {
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

export type MessageStream = AsyncIterable<AgentMessage>;

export interface AgentAdapter {
  readonly name: string;
  init(options: AgentInitOptions): Promise<void>;
  submitPrompt(prompt: string, options?: SubmitPromptOptions): Promise<MessageStream>;
  resume(
    sessionId: AgentSessionId,
    prompt: string,
    options?: SubmitPromptOptions,
  ): Promise<MessageStream>;
  close(): Promise<void>;
}
