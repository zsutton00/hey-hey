import type { AgentMessage, AgentSessionId, SubmitPromptOptions } from '../core/index';
import type { NodeAgentSessionCaptureOptions, SessionAwareMessageStream } from './NodeAgentClient';

export interface SessionRunnerCoreClient {
  runWithSession(
    prompt: string,
    options?: SubmitPromptOptions,
    captureOptions?: NodeAgentSessionCaptureOptions,
  ): Promise<SessionAwareMessageStream>;
  resumeWithSession(
    sessionId: AgentSessionId,
    prompt: string,
    options?: SubmitPromptOptions,
    captureOptions?: NodeAgentSessionCaptureOptions,
  ): Promise<SessionAwareMessageStream>;
}

export interface SessionRunnerCoreClientInit {
  cwd: string;
  startupTimeoutMs: number;
  defaultTimeoutMs: number;
  gracefulShutdownMs: number;
}

export interface SessionRunnerCoreRunPromptArgs {
  cwd: string;
  prompt: string;
  providerSessionId?: (AgentSessionId | string | null) | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  startupTimeoutMs?: number | undefined;
  defaultTimeoutMs?: number | undefined;
  gracefulShutdownMs?: number | undefined;
  sessionIdTimeoutMs?: number | undefined;
  onMessage?: ((message: AgentMessage) => void | Promise<void>) | undefined;
}

export interface SessionRunnerCoreRunResult {
  providerSessionId: AgentSessionId | null;
  errorCount: number;
}

export interface SessionRunnerCore {
  runPrompt(args: SessionRunnerCoreRunPromptArgs): Promise<SessionRunnerCoreRunResult>;
}

export interface SessionRunnerCoreOptions {
  createClient: (
    input: SessionRunnerCoreClientInit,
  ) => SessionRunnerCoreClient | Promise<SessionRunnerCoreClient>;
  sessionIdTimeoutMs?: number | undefined;
}
