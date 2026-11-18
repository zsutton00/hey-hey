import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  AgentSessionContinuationInspectionReason,
  AgentSessionContinuationNativeState,
  CliReadAgentSessionContinuationInspectEnvelopeBody,
  CliReadAgentSessionContinuationInspectResult,
} from '@hey-hey/contracts/agent-bridge/models';
import { ClaudeSessionReader } from '../provider-transcripts/claude-session-reader';
import type { RunStore } from '../run-store/run-store';
import type { AgenticSession } from '../session/types';
import type { ServerLogger } from './logger';

type ProviderStateProbe =
  | { state: 'present' }
  | { state: 'missing' }
  | { state: 'unreadable' }
  | { state: 'unsupported' };

export interface NativeStateClassification {
  nativeState: AgentSessionContinuationNativeState;
  reason: AgentSessionContinuationInspectionReason;
}

const classification = (
  nativeState: AgentSessionContinuationNativeState,
  reason: AgentSessionContinuationInspectionReason,
): NativeStateClassification => ({ nativeState, reason });

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const hasProviderSession = (session: AgenticSession): boolean =>
  Boolean(session.provider_session_id) && !session.provider_session_id.startsWith('pending_');

/**
 * Answers whether this computer can natively resume one Agent Session's
 * provider session. It reads only local Run metadata and the provider's own
 * session store, and reports a safe outcome; it never returns paths, transcript
 * content or credentials. A provider-session id alone is not proof of
 * usability: the provider's persisted conversation must also be present.
 */
export class AgentSessionContinuationInspector {
  private readonly claudeSessions: ClaudeSessionReader;

  public constructor(
    private readonly runStore: RunStore,
    private readonly logger: ServerLogger,
    private readonly codexHomes: readonly string[] = AgentSessionContinuationInspector.defaultCodexHomes(),
    claudeSessions?: ClaudeSessionReader,
  ) {
    this.claudeSessions = claudeSessions ?? new ClaudeSessionReader({ logger });
  }

  public async inspect(
    body: CliReadAgentSessionContinuationInspectEnvelopeBody,
  ): Promise<CliReadAgentSessionContinuationInspectResult> {
    const classification = await this.classify(body.agentSessionId, {
      conversationId: body.conversationId,
      provider: body.provider,
    });
    this.logger.info('agent_session.continuation.inspected', {
      agentSessionId: body.agentSessionId,
      continuationId: body.continuationId,
      ...classification,
    });
    return {
      agentSessionId: body.agentSessionId,
      continuationId: body.continuationId,
      ...classification,
    };
  }

  /** Classifies this computer's native state for one Run (its id is the Agent Session id). */
  public async classify(
    runId: string,
    expected: { conversationId: string; provider: string },
  ): Promise<NativeStateClassification> {
    let session: AgenticSession | null;
    try {
      session = await this.runStore.getRunMetadata(runId);
    } catch (error) {
      this.logger.warn('agent_session.continuation.run_metadata_unreadable', {
        runId,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      return classification('UNUSABLE', 'LOCAL_STATE_UNREADABLE');
    }
    if (!session) return classification('ABSENT', 'NO_LOCAL_RUN');
    if (session.conversationId !== expected.conversationId) {
      return classification('UNUSABLE', 'CONVERSATION_MISMATCH');
    }
    if (session.provider !== expected.provider) {
      return classification('UNUSABLE', 'PROVIDER_MISMATCH');
    }
    if (!hasProviderSession(session)) {
      return classification('ABSENT', 'NO_PROVIDER_SESSION');
    }

    const probe = await this.probeProviderState(session.provider, session.provider_session_id);
    switch (probe.state) {
      case 'present':
        return classification('USABLE', 'PROVIDER_STATE_PRESENT');
      case 'missing':
        return classification('ABSENT', 'PROVIDER_TRANSCRIPT_MISSING');
      case 'unreadable':
        return classification('UNUSABLE', 'LOCAL_STATE_UNREADABLE');
      case 'unsupported':
        return classification('UNUSABLE', 'PROVIDER_RESUME_UNSUPPORTED');
    }
  }

  private async probeProviderState(
    provider: string,
    providerSessionId: string,
  ): Promise<ProviderStateProbe> {
    if (provider === 'claude') {
      const read = await this.claudeSessions.read(providerSessionId);
      if (read.state === 'available') return { state: 'present' };
      return read.reason === 'SESSION_FILE_NOT_FOUND'
        ? { state: 'missing' }
        : { state: 'unreadable' };
    }
    if (provider === 'codex') return this.probeCodexRollout(providerSessionId);
    // No verified local store for this provider: never claim it is resumable.
    return { state: 'unsupported' };
  }

  /** Codex keeps one rollout file per thread, named `...-<threadId>.jsonl`. */
  private async probeCodexRollout(threadId: string): Promise<ProviderStateProbe> {
    const suffix = `-${threadId}.jsonl`;
    let sawStore = false;
    for (const home of this.codexHomes) {
      for (const kind of ['sessions', 'archived_sessions']) {
        try {
          const found = await this.containsFile(path.join(home, kind), suffix);
          sawStore = true;
          if (found) return { state: 'present' };
        } catch (error) {
          if (isMissing(error)) continue;
          this.logger.warn('agent_session.continuation.codex_store_unreadable', {
            error: error instanceof Error ? error.name : 'UnknownError',
          });
          return { state: 'unreadable' };
        }
      }
    }
    this.logger.debug('agent_session.continuation.codex_rollout_not_found', {
      threadId,
      sawStore,
    });
    return { state: 'missing' };
  }

  private async containsFile(directory: string, suffix: string): Promise<boolean> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && entry.name.endsWith(suffix)) return true;
      if (
        entry.isDirectory() &&
        (await this.containsFile(path.join(directory, entry.name), suffix))
      ) {
        return true;
      }
    }
    return false;
  }

  private static defaultCodexHomes(): readonly string[] {
    const configured = process.env['CODEX_HOME'];
    if (configured === undefined) return [path.join(homedir(), '.codex')];
    return configured
      .split(',')
      .map((root) => root.trim())
      .filter(Boolean);
  }
}
