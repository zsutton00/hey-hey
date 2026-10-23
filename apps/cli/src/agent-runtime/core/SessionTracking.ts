import type { MessageStream } from './AgentAdapter';
import type { AgentSessionMetadata, AgentSessionStore } from './AgentSessionStore';
import type { AgentMessage, AgentSessionId } from './types';

export type SessionTrackingMode = 'run' | 'resume';

export interface SessionMetadataContext {
  adapter: string;
  sessionId: AgentSessionId;
  now: number;
  mode: SessionTrackingMode;
  resumedFromSessionId: AgentSessionId | null;
}

export type SessionMetadataFactory<TSessionMetadata extends AgentSessionMetadata> = (
  context: SessionMetadataContext,
) => TSessionMetadata;

export interface SessionTrackingOptions<
  TSessionMetadata extends AgentSessionMetadata = AgentSessionMetadata,
> {
  stream: MessageStream;
  adapter: string;
  mode: SessionTrackingMode;
  sessionStore?: AgentSessionStore<TSessionMetadata> | undefined;
  resumedFromSessionId?: (AgentSessionId | null) | undefined;
  createSessionMetadata?: SessionMetadataFactory<TSessionMetadata> | undefined;
}

const toSessionTrackingErrorMessage = (
  subtype: 'session_metadata_error' | 'session_persist_error',
  adapter: string,
  sessionId: AgentSessionId,
  error: unknown,
): AgentMessage => ({
  type: 'error',
  subtype,
  sessionId,
  content: [
    {
      kind: 'error',
      payload: {
        adapter,
        message: error instanceof Error ? error.message : 'Unexpected session tracking error',
      },
    },
  ],
  timestamp: Date.now(),
  raw: error,
});

const defaultSessionMetadataFactory: SessionMetadataFactory<AgentSessionMetadata> = (context) => {
  if (context.mode === 'resume') {
    return {
      adapter: context.adapter,
      createdAt: context.now,
      updatedAt: context.now,
    };
  }

  return {
    adapter: context.adapter,
    createdAt: context.now,
  };
};

const hasSessionId = (
  message: AgentMessage,
): message is AgentMessage & { sessionId: AgentSessionId } => message.sessionId !== null;

const isSystemInitWithSessionId = (
  message: AgentMessage,
): message is AgentMessage & { sessionId: AgentSessionId } =>
  message.type === 'system' && message.subtype === 'init' && message.sessionId !== null;

export const trackSessionFromMessageStream = <
  TSessionMetadata extends AgentSessionMetadata = AgentSessionMetadata,
>(
  options: SessionTrackingOptions<TSessionMetadata>,
): MessageStream => {
  if (!options.sessionStore) {
    return options.stream;
  }

  const sessionStore = options.sessionStore;
  const createSessionMetadata =
    options.createSessionMetadata ??
    (defaultSessionMetadataFactory as SessionMetadataFactory<TSessionMetadata>);
  const resumedFromSessionId = options.resumedFromSessionId ?? null;

  return (async function* (): MessageStream {
    const persistedSessionIds = new Set<AgentSessionId>();
    let initSessionIdSeen = false;
    let fallbackSessionId: AgentSessionId | null = null;

    const persistSessionId = async (sessionId: AgentSessionId): Promise<AgentMessage | null> => {
      if (persistedSessionIds.has(sessionId)) {
        return null;
      }

      persistedSessionIds.add(sessionId);
      const now = Date.now();
      let metadata: TSessionMetadata;

      try {
        metadata = createSessionMetadata({
          adapter: options.adapter,
          sessionId,
          now,
          mode: options.mode,
          resumedFromSessionId,
        });
      } catch (error) {
        return toSessionTrackingErrorMessage(
          'session_metadata_error',
          options.adapter,
          sessionId,
          error,
        );
      }

      try {
        await sessionStore.persist(sessionId, metadata);
        return null;
      } catch (error) {
        return toSessionTrackingErrorMessage(
          'session_persist_error',
          options.adapter,
          sessionId,
          error,
        );
      }
    };

    for await (const message of options.stream) {
      yield message;

      if (isSystemInitWithSessionId(message)) {
        initSessionIdSeen = true;
        fallbackSessionId = null;
        const persistError = await persistSessionId(message.sessionId);
        if (persistError) {
          yield persistError;
        }
        continue;
      }

      if (!hasSessionId(message) || initSessionIdSeen) {
        continue;
      }

      if (!fallbackSessionId) {
        fallbackSessionId = message.sessionId;
      }
    }

    if (!initSessionIdSeen && fallbackSessionId) {
      const persistError = await persistSessionId(fallbackSessionId);
      if (persistError) {
        yield persistError;
      }
    }
  })();
};
