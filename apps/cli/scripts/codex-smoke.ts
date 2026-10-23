#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import type { AgentMessage } from '../src/agent-runtime/core/index.js';
import {
  createCodexSessionRunnerCore,
  summarizeAgentMessage,
} from '../src/agent-runtime/node/SessionRunnerCore.js';

const USAGE = `Usage: pnpm codex:smoke -- --prompt "<text>" [--cwd "<path>"] [--timeout-ms <number>]

Runs a minimal Codex smoke invocation via codex exec and exits on the first assistant message.
`;

interface SmokeOptions {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
}

type ParseResult =
  | {
      kind: 'ok';
      options: SmokeOptions;
    }
  | {
      kind: 'help';
    }
  | {
      kind: 'error';
      message: string;
    };

const coerceText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

const formatDiagnosticLine = (message: AgentMessage): string => {
  const summary = truncate(summarizeAgentMessage(message), 400);
  return `[codex-smoke] ${message.type}${message.subtype ? `:${message.subtype}` : ''} ${summary}`;
};

const parseArgs = (argv: readonly string[]): ParseResult => {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { kind: 'help' };
  }

  let prompt: string | null = null;
  let cwd = process.cwd();
  let timeoutMs: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      return { kind: 'error', message: 'Unexpected empty argument.' };
    }

    if (token === '--prompt') {
      const value = argv[index + 1];
      const parsedPrompt = coerceText(value);
      if (!parsedPrompt) {
        return {
          kind: 'error',
          message: 'Option "--prompt" requires a non-empty value.',
        };
      }
      prompt = parsedPrompt;
      index += 1;
      continue;
    }

    if (token === '--cwd') {
      const value = argv[index + 1];
      const parsedCwd = coerceText(value);
      if (!parsedCwd) {
        return {
          kind: 'error',
          message: 'Option "--cwd" requires a non-empty value.',
        };
      }
      cwd = path.resolve(parsedCwd);
      index += 1;
      continue;
    }

    if (token === '--timeout-ms') {
      const value = argv[index + 1];
      if (!value) {
        return {
          kind: 'error',
          message: 'Option "--timeout-ms" requires a numeric value.',
        };
      }

      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return {
          kind: 'error',
          message: 'Option "--timeout-ms" must be a positive integer.',
        };
      }
      timeoutMs = parsed;
      index += 1;
      continue;
    }

    return {
      kind: 'error',
      message: `Unknown argument "${token}".`,
    };
  }

  if (!prompt) {
    return {
      kind: 'error',
      message: 'Missing required option "--prompt <text>".',
    };
  }

  return {
    kind: 'ok',
    options: {
      prompt,
      cwd,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    },
  };
};

const run = async (): Promise<number> => {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.kind === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`[codex-smoke] ${parsed.message}\n`);
    process.stderr.write(USAGE);
    return 1;
  }

  const options = parsed.options;
  const defaultTimeoutMs = options.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const diagnostics: string[] = [];
  const runner = createCodexSessionRunnerCore();

  try {
    process.stdout.write(
      `[codex-smoke] launching codex in ${options.cwd} with timeout ${String(defaultTimeoutMs)}ms\n`,
    );

    let assistantSummary: string | null = null;
    let assistantSessionId: string | null = null;
    const result = await runner.runPrompt({
      cwd: options.cwd,
      prompt: options.prompt,
      signal: controller.signal,
      timeoutMs: options.timeoutMs,
      defaultTimeoutMs,
      onMessage: (message) => {
        if (!assistantSummary && message.type === 'assistant') {
          assistantSummary = summarizeAgentMessage(message);
          assistantSessionId = message.sessionId;
          controller.abort();
          return;
        }
        diagnostics.push(formatDiagnosticLine(message));
      },
    });

    if (!assistantSummary) {
      process.stderr.write(
        '[codex-smoke] failure: no assistant response captured before stream completion.\n',
      );
      for (const line of diagnostics) {
        process.stderr.write(`${line}\n`);
      }
      return 1;
    }

    process.stdout.write(
      `[codex-smoke] success: session=${result.providerSessionId ?? assistantSessionId ?? 'unknown'}\n`,
    );
    process.stdout.write(`[codex-smoke] assistant: ${assistantSummary}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[codex-smoke] failure: ${message}\n`);
    for (const line of diagnostics) {
      process.stderr.write(`${line}\n`);
    }
    return 1;
  }
};

void run().then((exitCode) => {
  process.exitCode = exitCode;
});
