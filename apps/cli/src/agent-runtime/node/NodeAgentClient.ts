import type {
  AgentAdapterId,
  AgentAdapterRegistry,
  AgentMessage,
  AgentInitOptions,
  AgentSessionId,
  AgentSessionMetadata,
  AgentSessionStore,
  MessageStream,
  SessionMetadataFactory,
  SubmitPromptOptions,
} from '../core/index';
import {
  FileSystemAgentSessionStore,
  InMemoryAgentSessionStore,
  PushableMessageStream,
} from '../core/index';
import { NodeAgentOrchestrator, type NodeAgentOrchestratorOptions } from './NodeAgentOrchestrator';
import type { NodeAdapterFactoryOptions } from './NodeAgentAdapterRegistry';

export interface NodeAgentClientOptions<
  TSessionMetadata extends AgentSessionMetadata = AgentSessionMetadata,
> {
  adapterId: AgentAdapterId;
  initOptions: AgentInitOptions;
  promptOptions?: SubmitPromptOptions | undefined;
  adapterFactoryOptions?: NodeAdapterFactoryOptions | undefined;
  registry?: AgentAdapterRegistry | undefined;
  sessionStore?: (AgentSessionStore<TSessionMetadata> | null) | undefined;
  createSessionMetadata?: SessionMetadataFactory<TSessionMetadata> | undefined;
  retryPolicies?: NodeAgentOrchestratorOptions<TSessionMetadata>['retryPolicies'] | undefined;
  errorVerbosity?: NodeAgentOrchestratorOptions<TSessionMetadata>['errorVerbosity'] | undefined;
  onNormalizedError?:
    | NodeAgentOrchestratorOptions<TSessionMetadata>['onNormalizedError']
    | undefined;
  orchestrator?: NodeAgentOrchestrator<TSessionMetadata> | undefined;
}

export interface SessionAwareMessageStream {
  stream: MessageStream;
  sessionIdPromise: Promise<AgentSessionId | null>;
}

export interface NodeAgentSessionCaptureOptions {
  sessionIdTimeoutMs?: number | undefined;
}

const isSystemInitWithSessionId = (
  message: AgentMessage,
): message is AgentMessage & { sessionId: AgentSessionId } =>
  message.type === 'system' && message.subtype === 'init' && message.sessionId !== null;

const mergePromptOptions = (
  defaults: SubmitPromptOptions | undefined,
  overrides: SubmitPromptOptions | undefined,
): SubmitPromptOptions | undefined => {
  if (!defaults && !overrides) {
    return undefined;
  }

  return {
    ...(defaults ?? {}),
    ...(overrides ?? {}),
  };
};

const createOrchestratorOptions = <TSessionMetadata extends AgentSessionMetadata>(
  options: NodeAgentClientOptions<TSessionMetadata>,
  sessionStore: AgentSessionStore<TSessionMetadata> | null,
): NodeAgentOrchestratorOptions<TSessionMetadata> => ({
  registry: options.registry,
  adapterFactoryOptions: options.adapterFactoryOptions,
  sessionStore: sessionStore ?? undefined,
  createSessionMetadata: options.createSessionMetadata,
  retryPolicies: options.retryPolicies,
  errorVerbosity: options.errorVerbosity,
  onNormalizedError: options.onNormalizedError,
});

const hasCredentialBindings = (
  adapterFactoryOptions: NodeAdapterFactoryOptions | undefined,
): boolean =>
  Boolean(
    adapterFactoryOptions?.claude?.credentialBinding ||
    adapterFactoryOptions?.codex?.credentialBinding,
  );

const createDefaultSessionStore = <TSessionMetadata extends AgentSessionMetadata>(
  adapterFactoryOptions: NodeAdapterFactoryOptions | undefined,
): AgentSessionStore<TSessionMetadata> =>
  hasCredentialBindings(adapterFactoryOptions)
    ? new FileSystemAgentSessionStore<TSessionMetadata>()
    : new InMemoryAgentSessionStore<TSessionMetadata>();

export class NodeAgentClient<TSessionMetadata extends AgentSessionMetadata = AgentSessionMetadata> {
  private readonly adapterId: AgentAdapterId;
  private readonly initOptions: AgentInitOptions;
  private readonly defaultPromptOptions?: SubmitPromptOptions | undefined;
  private readonly adapterFactoryOptions?: NodeAdapterFactoryOptions | undefined;
  private readonly sessionStore: AgentSessionStore<TSessionMetadata> | null;
  private readonly orchestrator: NodeAgentOrchestrator<TSessionMetadata>;

  constructor(options: NodeAgentClientOptions<TSessionMetadata>) {
    this.adapterId = options.adapterId;
    this.initOptions = options.initOptions;
    this.defaultPromptOptions = options.promptOptions;
    this.adapterFactoryOptions = options.adapterFactoryOptions;
    this.sessionStore =
      options.sessionStore === undefined
        ? createDefaultSessionStore<TSessionMetadata>(options.adapterFactoryOptions)
        : options.sessionStore;

    this.orchestrator =
      options.orchestrator ??
      new NodeAgentOrchestrator<TSessionMetadata>(
        createOrchestratorOptions(options, this.sessionStore),
      );
  }

  async runWithSession(
    prompt: string,
    options?: SubmitPromptOptions,
    captureOptions?: NodeAgentSessionCaptureOptions,
  ): Promise<SessionAwareMessageStream> {
    const stream = await this.run(prompt, options);
    return this.captureSessionIdFromStream(stream, captureOptions);
  }

  async run(prompt: string, options?: SubmitPromptOptions): Promise<MessageStream> {
    return this.orchestrator.run({
      adapterId: this.adapterId,
      prompt,
      initOptions: this.initOptions,
      promptOptions: mergePromptOptions(this.defaultPromptOptions, options),
      adapterFactoryOptions: this.adapterFactoryOptions,
    });
  }

  async resumeWithSession(
    sessionId: AgentSessionId,
    prompt: string,
    options?: SubmitPromptOptions,
    captureOptions?: NodeAgentSessionCaptureOptions,
  ): Promise<SessionAwareMessageStream> {
    const stream = await this.resume(sessionId, prompt, options);
    return this.captureSessionIdFromStream(stream, captureOptions, sessionId);
  }

  async resume(
    sessionId: AgentSessionId,
    prompt: string,
    options?: SubmitPromptOptions,
  ): Promise<MessageStream> {
    return this.orchestrator.resume({
      adapterId: this.adapterId,
      sessionId,
      prompt,
      initOptions: this.initOptions,
      promptOptions: mergePromptOptions(this.defaultPromptOptions, options),
      adapterFactoryOptions: this.adapterFactoryOptions,
    });
  }

  async getSessionMetadata(sessionId: AgentSessionId): Promise<TSessionMetadata | null> {
    if (!this.sessionStore) {
      return null;
    }

    return this.sessionStore.retrieve(sessionId);
  }

  getSessionStore(): AgentSessionStore<TSessionMetadata> | null {
    return this.sessionStore;
  }

  private captureSessionIdFromStream(
    stream: MessageStream,
    captureOptions?: NodeAgentSessionCaptureOptions,
    fallbackSessionId?: AgentSessionId,
  ): SessionAwareMessageStream {
    let resolveSessionId: (value: AgentSessionId | null) => void = () => {};
    const sessionIdPromise = new Promise<AgentSessionId | null>((resolve) => {
      resolveSessionId = resolve;
    });

    let isResolved = false;
    let initSessionId: AgentSessionId | null = null;
    let observedFallbackSessionId: AgentSessionId | null = null;

    const resolveOnce = (value: AgentSessionId | null): void => {
      if (isResolved) {
        return;
      }

      isResolved = true;
      resolveSessionId(value);
    };

    const timeoutMs = captureOptions?.sessionIdTimeoutMs;
    const timeoutId =
      typeof timeoutMs === 'number' && timeoutMs > 0
        ? setTimeout(() => {
            resolveOnce(initSessionId ?? observedFallbackSessionId ?? fallbackSessionId ?? null);
          }, timeoutMs)
        : null;

    const wrappedStream = new PushableMessageStream<AgentMessage>();

    (async () => {
      try {
        for await (const message of stream) {
          if (isSystemInitWithSessionId(message)) {
            initSessionId = message.sessionId;
            resolveOnce(initSessionId);
          } else if (!observedFallbackSessionId && message.sessionId) {
            observedFallbackSessionId = message.sessionId;
          }

          wrappedStream.push(message);
        }

        resolveOnce(initSessionId ?? observedFallbackSessionId ?? fallbackSessionId ?? null);
        wrappedStream.complete();
      } catch (error) {
        resolveOnce(initSessionId ?? observedFallbackSessionId ?? fallbackSessionId ?? null);
        wrappedStream.fail(error instanceof Error ? error : new Error('Agent stream failed'));
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    })();

    return {
      stream: wrappedStream,
      sessionIdPromise,
    };
  }
}

export const createNodeAgentClient = <
  TSessionMetadata extends AgentSessionMetadata = AgentSessionMetadata,
>(
  options: NodeAgentClientOptions<TSessionMetadata>,
): NodeAgentClient<TSessionMetadata> => new NodeAgentClient(options);
