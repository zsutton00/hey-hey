import type { AgentMessage, AgentSessionId } from "../core";
import { toAgentSessionId } from "../core";
import {
  createCodexExecClient,
  type CodexExecClientOptions,
} from "./CodexExecClient";
import type {
  SessionRunnerCore,
  SessionRunnerCoreOptions,
  SessionRunnerCoreRunPromptArgs,
  SessionRunnerCoreRunResult,
} from "./types";

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 600_000;
const DEFAULT_GRACEFUL_SHUTDOWN_MS = 5_000;
const DEFAULT_SESSION_ID_TIMEOUT_MS = 5_000;

const coerceText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const extractMessageText = (payload: unknown): string | null => {
  const direct = coerceText(payload);
  if (direct) {
    return direct;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const text = coerceText(record.text);
  if (text) {
    return text;
  }

  const message = coerceText(record.message);
  if (message) {
    return message;
  }

  const nestedPayload = record.payload;
  if (nestedPayload !== undefined) {
    return extractMessageText(nestedPayload);
  }

  return null;
};

export const summarizeAgentMessage = (message: AgentMessage): string => {
  for (const item of message.content) {
    const text = extractMessageText(item.payload);
    if (text) {
      return text;
    }
  }

  return JSON.stringify(message.content[0]?.payload ?? message.raw ?? {});
};

const normalizeProviderSessionId = (
  sessionId: SessionRunnerCoreRunPromptArgs["providerSessionId"]
): AgentSessionId | null => {
  if (sessionId === null || sessionId === undefined) {
    return null;
  }

  const normalized = coerceText(sessionId);
  return normalized ? toAgentSessionId(normalized) : null;
};

export const createSessionRunnerCore = (
  options: SessionRunnerCoreOptions
): SessionRunnerCore => ({
  async runPrompt(
    args: SessionRunnerCoreRunPromptArgs
  ): Promise<SessionRunnerCoreRunResult> {
    const startupTimeoutMs =
      args.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    const defaultTimeoutMs = args.defaultTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
    const gracefulShutdownMs =
      args.gracefulShutdownMs ?? DEFAULT_GRACEFUL_SHUTDOWN_MS;
    const sessionIdTimeoutMs =
      args.sessionIdTimeoutMs ??
      options.sessionIdTimeoutMs ??
      DEFAULT_SESSION_ID_TIMEOUT_MS;
    const providerSessionId = normalizeProviderSessionId(
      args.providerSessionId
    );

    const client = await options.createClient({
      cwd: args.cwd,
      startupTimeoutMs,
      defaultTimeoutMs,
      gracefulShutdownMs,
    });

    const promptOptions =
      args.signal || args.timeoutMs
        ? {
            ...(args.signal ? { signal: args.signal } : {}),
            ...(args.timeoutMs !== undefined
              ? { timeoutMs: args.timeoutMs }
              : {}),
          }
        : undefined;

    const invocation = providerSessionId
      ? await client.resumeWithSession(
          providerSessionId,
          args.prompt,
          promptOptions,
          {
            sessionIdTimeoutMs,
          }
        )
      : await client.runWithSession(args.prompt, promptOptions, {
          sessionIdTimeoutMs,
        });

    let errorCount = 0;
    for await (const message of invocation.stream) {
      if (message.type === "error") {
        errorCount += 1;
      }

      if (args.onMessage) {
        await args.onMessage(message);
      }
    }

    const capturedSessionId = await invocation.sessionIdPromise;
    return {
      providerSessionId: capturedSessionId ?? providerSessionId,
      errorCount,
    };
  },
});

export interface CodexSessionRunnerCoreOptions {
  codex?: CodexExecClientOptions["codex"];
  sessionIdTimeoutMs?: number;
}

export const createCodexSessionRunnerCore = (
  options: CodexSessionRunnerCoreOptions = {}
): SessionRunnerCore =>
  createSessionRunnerCore({
    sessionIdTimeoutMs: options.sessionIdTimeoutMs,
    createClient: (init) =>
      createCodexExecClient({
        initOptions: {
          cwd: init.cwd,
          startupTimeoutMs: init.startupTimeoutMs,
          defaultTimeoutMs: init.defaultTimeoutMs,
          gracefulShutdownMs: init.gracefulShutdownMs,
        },
        codex: options.codex,
      }),
  });
