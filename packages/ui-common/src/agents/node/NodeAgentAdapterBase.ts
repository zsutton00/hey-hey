import { spawn, type ChildProcess } from "node:child_process";
import type { SpawnOptionsWithoutStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  AgentAdapter,
  AgentInitOptions,
  MessageStream,
  SubmitPromptOptions,
} from "../core";
import type { AgentDecoder, AgentMessage, AgentSessionId } from "../core";
import {
  NdjsonAgentDecoder,
  PushableMessageStream,
  toAgentRunId,
} from "../core";

export const DEFAULT_PROMPT_TIMEOUT_MS = 30_000;
export const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
export const DEFAULT_GRACEFUL_SHUTDOWN_MS = 5_000;

export interface NodeSpawnRequest {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  spawnOptions?: Omit<SpawnOptionsWithoutStdio, "cwd" | "env">;
}

export interface BuildSpawnRequestContext {
  prompt: string;
  resumeSessionId: AgentSessionId | null;
  initOptions: AgentInitOptions;
  promptOptions: SubmitPromptOptions;
}

interface ActiveInvocation {
  process: ChildProcess;
  stream: PushableMessageStream<AgentMessage>;
  decoder: AgentDecoder;
  terminate: () => void;
  cleanup: () => void;
}

const toErrorMessage = (
  subtype: string,
  payload: unknown,
  sessionId: AgentSessionId | null = null
): AgentMessage => ({
  type: "error",
  subtype,
  sessionId,
  content: [{ kind: "error", payload }],
  timestamp: Date.now(),
  raw: payload,
});

const toStderrMessage = (text: string): AgentMessage => ({
  type: "error",
  subtype: "stderr",
  sessionId: null,
  content: [{ kind: "error", payload: { message: text } }],
  timestamp: Date.now(),
  raw: text,
});

export abstract class NodeAgentAdapterBase implements AgentAdapter {
  readonly name: string;

  private initOptions: AgentInitOptions | null = null;
  private activeInvocations = new Set<ActiveInvocation>();
  private lastSessionId: AgentSessionId | null = null;

  protected constructor(
    name: string,
    private readonly decoderFactory: () => AgentDecoder = () =>
      new NdjsonAgentDecoder()
  ) {
    this.name = name;
  }

  async init(options: AgentInitOptions): Promise<void> {
    this.initOptions = {
      ...options,
      startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS,
      gracefulShutdownMs:
        options.gracefulShutdownMs ?? DEFAULT_GRACEFUL_SHUTDOWN_MS,
    };
  }

  async submitPrompt(
    prompt: string,
    options: SubmitPromptOptions = {}
  ): Promise<MessageStream> {
    return this.startInvocation(prompt, null, options);
  }

  async resume(
    sessionId: AgentSessionId,
    prompt: string,
    options: SubmitPromptOptions = {}
  ): Promise<MessageStream> {
    this.lastSessionId = sessionId;
    return this.startInvocation(prompt, sessionId, options);
  }

  async close(): Promise<void> {
    const invocations = Array.from(this.activeInvocations);
    const gracefulShutdownMs =
      this.initOptions?.gracefulShutdownMs ?? DEFAULT_GRACEFUL_SHUTDOWN_MS;

    await Promise.all(
      invocations.map(
        (invocation) =>
          new Promise<void>((resolve) => {
            const onClose = () => {
              clearTimeout(closeWaitTimeout);
              resolve();
            };

            const closeWaitTimeout = setTimeout(() => {
              invocation.process.removeListener("close", onClose);
              resolve();
            }, gracefulShutdownMs * 2);

            invocation.process.once("close", onClose);

            if (
              invocation.process.exitCode !== null ||
              invocation.process.signalCode !== null
            ) {
              invocation.process.removeListener("close", onClose);
              clearTimeout(closeWaitTimeout);
              resolve();
              return;
            }

            invocation.terminate();
          })
      )
    );
  }

  protected abstract buildSpawnRequest(
    context: BuildSpawnRequestContext
  ): NodeSpawnRequest | Promise<NodeSpawnRequest>;

  private getInitializedOptions(): AgentInitOptions {
    if (!this.initOptions) {
      throw new Error(`${this.name} adapter has not been initialized`);
    }
    return this.initOptions;
  }

  private async startInvocation(
    prompt: string,
    resumeSessionId: AgentSessionId | null,
    promptOptions: SubmitPromptOptions
  ): Promise<MessageStream> {
    const initOptions = this.getInitializedOptions();
    const spawnRequest = await this.buildSpawnRequest({
      prompt,
      resumeSessionId,
      initOptions,
      promptOptions,
    });
    const stream = new PushableMessageStream<AgentMessage>();
    const decoder = this.decoderFactory();
    const runId = toAgentRunId(randomUUID());
    const timeoutMs =
      promptOptions.timeoutMs ??
      spawnRequest.timeoutMs ??
      initOptions.defaultTimeoutMs ??
      DEFAULT_PROMPT_TIMEOUT_MS;
    const startupTimeoutMs =
      initOptions.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    const gracefulShutdownMs =
      initOptions.gracefulShutdownMs ?? DEFAULT_GRACEFUL_SHUTDOWN_MS;

    if (promptOptions.signal?.aborted) {
      stream.push(
        toErrorMessage("aborted", {
          message: "Prompt was aborted",
          runId,
        })
      );
      stream.complete();
      return stream;
    }

    const child = spawn(spawnRequest.command, spawnRequest.args, {
      cwd: spawnRequest.cwd ?? initOptions.cwd,
      env: {
        ...process.env,
        ...(initOptions.env ?? {}),
        ...(spawnRequest.env ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      ...(spawnRequest.spawnOptions ?? {}),
    });

    let startupTimer: NodeJS.Timeout | null = null;
    let promptTimer: NodeJS.Timeout | null = null;
    let forceKillTimer: NodeJS.Timeout | null = null;
    let isTerminationInitiated = false;
    let reportProcessExit = true;
    let isCleanedUp = false;

    const clearForceKillTimer = () => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
    };

    const clearTimers = () => {
      if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = null;
      }
      if (promptTimer) {
        clearTimeout(promptTimer);
        promptTimer = null;
      }
    };

    const terminateProcess = () => {
      if (isTerminationInitiated) {
        return;
      }

      isTerminationInitiated = true;
      reportProcessExit = false;
      clearTimers();

      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) {
          return;
        }
        child.kill("SIGKILL");
      }, gracefulShutdownMs);
    };

    const onAbort = () => {
      stream.push(
        toErrorMessage("aborted", {
          message: "Prompt was aborted",
          runId,
        })
      );
      terminateProcess();
    };

    const invocation: ActiveInvocation = {
      process: child,
      stream,
      decoder,
      terminate: terminateProcess,
      cleanup: () => {
        if (isCleanedUp) {
          return;
        }

        isCleanedUp = true;
        clearTimers();
        clearForceKillTimer();
        promptOptions.signal?.removeEventListener("abort", onAbort);
        this.activeInvocations.delete(invocation);
      },
    };

    this.activeInvocations.add(invocation);

    startupTimer = setTimeout(() => {
      stream.push(
        toErrorMessage("startup_timeout", {
          message: `${this.name} did not emit a spawn event before startup timeout`,
          runId,
          timeoutMs: startupTimeoutMs,
        })
      );
      terminateProcess();
    }, startupTimeoutMs);

    promptTimer = setTimeout(() => {
      stream.push(
        toErrorMessage("timeout", {
          message: `${this.name} exceeded prompt timeout`,
          runId,
          timeoutMs,
        })
      );
      terminateProcess();
    }, timeoutMs);

    if (promptOptions.signal) {
      promptOptions.signal.addEventListener("abort", onAbort, { once: true });
      if (promptOptions.signal.aborted) {
        onAbort();
      }
    }

    child.once("spawn", () => {
      if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = null;
      }
    });

    child.on("error", (error) => {
      reportProcessExit = false;
      stream.push(
        toErrorMessage("spawn_error", {
          message: error.message,
          runId,
        })
      );
      stream.complete();
      invocation.cleanup();
    });

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer | string) => {
        const data = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const messages = decoder.decode(data);
        for (const message of messages) {
          if (message.sessionId) {
            this.lastSessionId = message.sessionId;
          }
          stream.push(message);
        }
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer | string) => {
        const data = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const trimmed = data.trim();
        if (trimmed.length > 0) {
          stream.push(toStderrMessage(trimmed));
        }
      });
    }

    child.once("close", (code, signal) => {
      const remaining = decoder.flush();
      for (const message of remaining) {
        if (message.sessionId) {
          this.lastSessionId = message.sessionId;
        }
        stream.push(message);
      }

      if (code !== 0 && reportProcessExit) {
        stream.push(
          toErrorMessage("process_exit", {
            message: `${this.name} exited with a non-zero status`,
            runId,
            code,
            signal,
          })
        );
      }

      stream.complete();
      invocation.cleanup();
    });
    return stream;
  }

  protected getCurrentSessionId(): AgentSessionId | null {
    return this.lastSessionId;
  }
}
