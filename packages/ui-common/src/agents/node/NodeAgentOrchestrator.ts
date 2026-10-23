import type {
  AgentAdapter,
  AgentAdapterId,
  AgentAdapterRegistry,
  AgentInitOptions,
  AgentSessionId,
  AgentSessionMetadata,
  AgentSessionStore,
  MessageStream,
  SessionMetadataFactory,
  SubmitPromptOptions,
} from "../core";
import { trackSessionFromMessageStream } from "../core";
import {
  createNodeAdapterRegistry,
  type NodeAdapterFactoryOptions,
} from "./NodeAgentAdapterRegistry";
import {
  isCredentialAwareNodeAdapter,
  isCredentialRefreshCapableNodeAdapter,
} from "./AgentCredentialBinding";
import {
  classifyCredentialRefreshFailure,
  classifyAgentInvocationException,
  classifyAgentMessageError,
  isAuthFailure,
  isRetryableInvocationFailure,
  toNormalizedAgentErrorEnvelope,
  type NormalizedAgentErrorEnvelope,
  type NormalizedAgentErrorEvent,
  type NormalizedAgentErrorVerbosity,
} from "./AgentInvocationErrorHandling";
import {
  computeAgentRetryDelayMs,
  resolveAgentInvocationRetryPolicy,
  waitForRetryDelay,
  type AgentInvocationRetryPolicy,
  type AgentInvocationRetryPolicyOverrides,
} from "./AgentInvocationRetryPolicy";

export interface NodeAgentRunRequest {
  adapterId: AgentAdapterId;
  prompt: string;
  initOptions: AgentInitOptions;
  promptOptions?: SubmitPromptOptions;
  adapterFactoryOptions?: NodeAdapterFactoryOptions;
}

export interface NodeAgentResumeRequest extends NodeAgentRunRequest {
  sessionId: AgentSessionId;
}

export type NormalizedAgentErrorSink = (
  event: NormalizedAgentErrorEvent,
  envelope: NormalizedAgentErrorEnvelope
) => void | Promise<void>;

export interface NodeAgentOrchestratorOptions<
  TSessionMetadata extends AgentSessionMetadata = AgentSessionMetadata
> {
  registry?: AgentAdapterRegistry;
  adapterFactoryOptions?: NodeAdapterFactoryOptions;
  sessionStore?: AgentSessionStore<TSessionMetadata>;
  createSessionMetadata?: SessionMetadataFactory<TSessionMetadata>;
  retryPolicies?: AgentInvocationRetryPolicyOverrides;
  errorVerbosity?: NormalizedAgentErrorVerbosity;
  onNormalizedError?: NormalizedAgentErrorSink;
}

type InvocationMode = "run" | "resume";

type InvocationRequest = NodeAgentRunRequest | NodeAgentResumeRequest;

interface StartedAttempt {
  adapter: AgentAdapter;
  stream: MessageStream;
}

type AttemptStartOutcome =
  | {
      kind: "started";
      value: StartedAttempt;
    }
  | {
      kind: "retry";
      delayMs: number;
    }
  | {
      kind: "fail";
      error: unknown;
    };

interface AttemptContinuation {
  kind: "success" | "retry" | "fail";
  delayMs?: number;
  error?: unknown;
}

const toResumeSessionId = (
  mode: InvocationMode,
  request: InvocationRequest
): AgentSessionId | null =>
  mode === "resume" ? (request as NodeAgentResumeRequest).sessionId : null;

export class NodeAgentOrchestrator<
  TSessionMetadata extends AgentSessionMetadata = AgentSessionMetadata
> {
  constructor(
    private readonly options: NodeAgentOrchestratorOptions<TSessionMetadata> = {}
  ) {}

  async run(request: NodeAgentRunRequest): Promise<MessageStream> {
    return this.executeWithRecovery("run", request);
  }

  async resume(request: NodeAgentResumeRequest): Promise<MessageStream> {
    return this.executeWithRecovery("resume", request);
  }

  private executeWithRecovery(
    mode: InvocationMode,
    request: InvocationRequest
  ): MessageStream {
    const { options } = this;
    const startAttempt = this.startAttempt.bind(this);
    const emitNormalizedError = this.emitNormalizedError.bind(this);
    const resolveAttemptFailure = this.resolveAttemptFailure.bind(this);
    const retryPolicy = resolveAgentInvocationRetryPolicy(
      request.adapterId,
      options.retryPolicies
    );
    const persistedSessionIds = new Set<AgentSessionId>();
    const resumedFromSessionId = toResumeSessionId(mode, request);

    return (async function* (): MessageStream {
      for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
        const startOutcome = await startAttempt(
          mode,
          request,
          attempt,
          retryPolicy,
          persistedSessionIds,
          resumedFromSessionId
        );

        if (startOutcome.kind === "retry") {
          if (startOutcome.delayMs > 0) {
            await waitForRetryDelay(startOutcome.delayMs);
          }
          continue;
        }

        if (startOutcome.kind === "fail") {
          throw startOutcome.error;
        }

        const { adapter, stream } = startOutcome.value;
        let continuation: AttemptContinuation = {
          kind: "success",
        };
        let terminalError: NormalizedAgentErrorEvent | null = null;

        try {
          for await (const message of stream) {
            yield message;

            const classification = classifyAgentMessageError(message, {
              adapter: adapter.name,
              attempt,
              maxAttempts: retryPolicy.maxAttempts,
            });
            if (!classification) {
              continue;
            }

            await emitNormalizedError(classification);
            if (classification.terminal) {
              terminalError = classification;
            }
          }

          if (terminalError) {
            continuation = await resolveAttemptFailure({
              adapter,
              event: terminalError,
              attempt,
              retryPolicy,
              streamError: null,
            });
          }
        } catch (error) {
          const streamFailure = classifyAgentInvocationException(
            error,
            {
              adapter: adapter.name,
              attempt,
              maxAttempts: retryPolicy.maxAttempts,
            },
            resumedFromSessionId
          );
          await emitNormalizedError(streamFailure);

          continuation = await resolveAttemptFailure({
            adapter,
            event: streamFailure,
            attempt,
            retryPolicy,
            streamError: error,
          });
        } finally {
          await adapter.close();
        }

        if (continuation.kind === "success") {
          return;
        }

        if (continuation.kind === "fail") {
          if (continuation.error) {
            throw continuation.error;
          }
          return;
        }

        if (continuation.delayMs && continuation.delayMs > 0) {
          await waitForRetryDelay(continuation.delayMs);
        }
      }
    })();
  }

  private async startAttempt(
    mode: InvocationMode,
    request: InvocationRequest,
    attempt: number,
    retryPolicy: AgentInvocationRetryPolicy,
    persistedSessionIds: Set<AgentSessionId>,
    resumedFromSessionId: AgentSessionId | null
  ): Promise<AttemptStartOutcome> {
    const adapter = this.createAdapter(
      request.adapterId,
      request.adapterFactoryOptions
    );

    try {
      await adapter.init(request.initOptions);

      const rawStream =
        mode === "run"
          ? await adapter.submitPrompt(request.prompt, request.promptOptions)
          : await adapter.resume(
              (request as NodeAgentResumeRequest).sessionId,
              request.prompt,
              request.promptOptions
            );

      const trackedStream = trackSessionFromMessageStream({
        stream: rawStream,
        adapter: adapter.name,
        mode,
        resumedFromSessionId,
        sessionStore: this.wrapSessionStoreForRetries(persistedSessionIds),
        createSessionMetadata: this.createSessionMetadataFactory(adapter),
      });

      return {
        kind: "started",
        value: {
          adapter,
          stream: trackedStream,
        },
      };
    } catch (error) {
      const classification = classifyAgentInvocationException(
        error,
        {
          adapter: adapter.name,
          attempt,
          maxAttempts: retryPolicy.maxAttempts,
        },
        resumedFromSessionId
      );
      await this.emitNormalizedError(classification);

      let outcome: AttemptStartOutcome = {
        kind: "fail",
        error,
      };

      if (isAuthFailure(classification)) {
        const refreshSucceeded = await this.tryCredentialRefresh(
          adapter,
          classification,
          attempt,
          retryPolicy
        );

        if (refreshSucceeded && attempt < retryPolicy.maxAttempts) {
          outcome = {
            kind: "retry",
            delayMs: 0,
          };
        }
      } else if (
        isRetryableInvocationFailure(classification) &&
        attempt < retryPolicy.maxAttempts
      ) {
        outcome = {
          kind: "retry",
          delayMs: computeAgentRetryDelayMs(attempt, retryPolicy),
        };
      }

      await adapter.close();
      return outcome;
    }
  }

  private async resolveAttemptFailure(input: {
    adapter: AgentAdapter;
    event: NormalizedAgentErrorEvent;
    attempt: number;
    retryPolicy: AgentInvocationRetryPolicy;
    streamError: unknown | null;
  }): Promise<AttemptContinuation> {
    const { adapter, event, attempt, retryPolicy, streamError } = input;

    if (isAuthFailure(event)) {
      const refreshSucceeded = await this.tryCredentialRefresh(
        adapter,
        event,
        attempt,
        retryPolicy
      );

      if (refreshSucceeded && attempt < retryPolicy.maxAttempts) {
        return {
          kind: "retry",
          delayMs: 0,
        };
      }

      return {
        kind: "fail",
        error: streamError ?? undefined,
      };
    }

    if (
      isRetryableInvocationFailure(event) &&
      attempt < retryPolicy.maxAttempts
    ) {
      return {
        kind: "retry",
        delayMs: computeAgentRetryDelayMs(attempt, retryPolicy),
      };
    }

    return {
      kind: "fail",
      error: streamError ?? undefined,
    };
  }

  private createAdapter(
    adapterId: AgentAdapterId,
    requestFactoryOptions?: NodeAdapterFactoryOptions
  ): AgentAdapter {
    const registry =
      this.options.registry ??
      createNodeAdapterRegistry(
        requestFactoryOptions ?? this.options.adapterFactoryOptions
      );
    return registry.create(adapterId);
  }

  private createSessionMetadataFactory(
    adapter: AgentAdapter
  ): SessionMetadataFactory<TSessionMetadata> | undefined {
    const baseFactory = this.options.createSessionMetadata;
    const credentialLifecycle = isCredentialAwareNodeAdapter(adapter)
      ? adapter.getCredentialLifecycleMetadata()
      : null;

    if (!baseFactory && !credentialLifecycle) {
      return undefined;
    }

    return (context) => {
      const baseMetadata =
        baseFactory?.(context) ??
        ({
          adapter: context.adapter,
          createdAt: context.now,
          ...(context.mode === "resume" ? { updatedAt: context.now } : {}),
        } as TSessionMetadata);

      if (!credentialLifecycle) {
        return baseMetadata;
      }

      return {
        ...baseMetadata,
        credentialLifecycle,
      };
    };
  }

  private wrapSessionStoreForRetries(
    persistedSessionIds: Set<AgentSessionId>
  ): AgentSessionStore<TSessionMetadata> | undefined {
    const sessionStore = this.options.sessionStore;
    if (!sessionStore) {
      return undefined;
    }

    return {
      persist: async (sessionId, metadata) => {
        if (persistedSessionIds.has(sessionId)) {
          return;
        }

        persistedSessionIds.add(sessionId);
        await sessionStore.persist(sessionId, metadata);
      },
      retrieve: (sessionId) => sessionStore.retrieve(sessionId),
    };
  }

  private async tryCredentialRefresh(
    adapter: AgentAdapter,
    event: NormalizedAgentErrorEvent,
    attempt: number,
    retryPolicy: AgentInvocationRetryPolicy
  ): Promise<boolean> {
    if (!isCredentialRefreshCapableNodeAdapter(adapter)) {
      return false;
    }

    try {
      await adapter.refreshCredential();
      return true;
    } catch (error) {
      const refreshFailure = classifyCredentialRefreshFailure(
        error,
        {
          adapter: adapter.name,
          attempt,
          maxAttempts: retryPolicy.maxAttempts,
        },
        event.sessionId
      );
      await this.emitNormalizedError(refreshFailure);
      return false;
    }
  }

  private async emitNormalizedError(
    event: NormalizedAgentErrorEvent
  ): Promise<void> {
    if (!this.options.onNormalizedError) {
      return;
    }

    const verbosity: NormalizedAgentErrorVerbosity =
      this.options.errorVerbosity ?? "detailed";
    const envelope = toNormalizedAgentErrorEnvelope(event, verbosity);

    try {
      await this.options.onNormalizedError(event, envelope);
    } catch {
      // Error sinks are side-channel observability and should not break invocation flow.
    }
  }
}
