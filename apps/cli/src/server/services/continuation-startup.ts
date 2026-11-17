import path from 'node:path';
import { z } from 'zod';
import { AgentSessionsApi } from '@hey-hey/contracts/api';
import { Configuration } from '@hey-hey/contracts/api/configuration';
import type {
  AgentSessionContinuationMarker,
  AgentSessionContinuationStartupOutcome,
  AgentSessionContinuationStartupReport,
} from '@hey-hey/contracts/api/models';
import {
  readJsonFile,
  writeJsonFileAtomic,
} from '../../agent-runtime/credentials/storage/fileUtils';
import { AgentSessionRunnerError } from '../../agents/providers/session-runner';
import type { KeyPairStore } from '../../credentials/keypair';
import type { RunStore } from '../../run-store/run-store';
import type { AgenticSession } from '../../session/types';
import type { AgentSessionContinuationInspector } from '../agent-session-continuation-inspector';
import type { ServerLogger } from '../logger';
import { CONTINUATION_MEMO_SOURCE } from './run-continuation';

/** One delivered continuation whose provider startup this computer must confirm. */
export interface ContinuationStartupInput {
  marker: AgentSessionContinuationMarker;
  /** The Agent Session id, which is also its Run id. */
  agentSessionId: string;
  organizationId: string;
  projectId: string;
  conversationId: string;
  deliveryOperationId: string;
}

interface StartupDecision {
  outcome: AgentSessionContinuationStartupOutcome;
  reasonCode?: string;
  detail?: string;
}

/** Outcomes that established a usable provider state; a retry re-reports them instead of probing again. */
const SETTLED_OUTCOMES: readonly AgentSessionContinuationStartupOutcome[] = [
  'RESUMED',
  'PREPARED_FROM_HISTORY',
];

const recordSchema = z.object({
  continuationId: z.string(),
  mode: z.enum(['NATIVE_RESUME', 'SAVED_HISTORY']),
  outcome: z.enum(['RESUMED', 'PREPARED_FROM_HISTORY']),
  decidedAt: z.string(),
});
type StartupRecord = z.infer<typeof recordSchema>;

/** Error codes meaning the provider cannot resume this session here, as opposed to a transient failure. */
const RESUME_UNAVAILABLE_CODES = new Set(['SESSION_NOT_FOUND', 'PROVIDER_SESSION_ID_MISSING']);

const REPORT_ATTEMPTS = 5;
const REPORT_BACKOFF_MS = 2_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Safe for the platform: a code and an error class name, never a message that may hold paths or content. */
const safeDetail = (error: unknown): string =>
  error instanceof Error ? error.name : 'UnknownError';

const httpStatusOf = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return null;
  }
  const response = (error as { response?: { status?: unknown } }).response;
  return typeof response?.status === 'number' ? response.status : null;
};

/** Provider-session probes this owner needs from the runtime. */
export interface ContinuationProviderProbe {
  /** Resumes the persisted provider session without sending a prompt, then releases it. */
  resumeProviderSessionWithoutPrompt(session: AgenticSession): Promise<void>;
  /** Whether this computer's provider catalog reports the provider as launchable. */
  isProviderAvailable(provider: string): Promise<boolean>;
}

/**
 * Confirms provider startup for one continuation delivery on this computer
 * and reports the outcome to the platform under this machine's credential.
 *
 * NATIVE_RESUME re-checks local provider state, then resumes the original
 * provider session without a prompt; a provider that cannot resume it is
 * reported as a rejection, never answered by silently starting fresh.
 * SAVED_HISTORY confirms the saved history is staged, the previous provider
 * identity is cleared and the provider is available; the new provider session
 * starts with the person's next message, because a provider session's tools
 * and startup context are fixed when it starts.
 *
 * A settled outcome is recorded per continuation, so a retried delivery of
 * the same attempt re-reports it instead of probing again.
 */
export class ContinuationStartup {
  private readonly recordsDirectory: string;

  public constructor(
    private readonly dependencies: {
      runStore: RunStore;
      inspector: AgentSessionContinuationInspector;
      providers: ContinuationProviderProbe;
      keyPairStore: KeyPairStore;
      apiBaseUrl: string;
      dataDirectory: string;
      logger: ServerLogger;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.recordsDirectory = path.join(dependencies.dataDirectory, 'continuation-startups');
  }

  /** Probes and reports; every failure is logged here, so callers may fire and forget. */
  public async confirm(input: ContinuationStartupInput): Promise<void> {
    const { marker } = input;
    const fields = {
      runId: input.agentSessionId,
      continuationId: marker.continuationId,
      mode: marker.mode,
      deliveryOperationId: input.deliveryOperationId,
    };
    try {
      const recorded = await this.readRecord(marker);
      const decision = recorded ? { outcome: recorded.outcome } : await this.decide(input);
      this.dependencies.logger.info('agent_session.continuation.startup_decided', {
        ...fields,
        outcome: decision.outcome,
        reasonCode: decision.reasonCode ?? null,
        reused: recorded !== null,
      });
      if (!recorded && SETTLED_OUTCOMES.includes(decision.outcome)) {
        await this.writeRecord(marker, decision.outcome);
      }
      await this.report(input, {
        deliveryOperationId: input.deliveryOperationId,
        outcome: decision.outcome,
        ...(decision.reasonCode ? { reasonCode: decision.reasonCode } : {}),
        ...(decision.detail ? { detail: decision.detail } : {}),
      });
    } catch (error) {
      // The platform marks the attempt uncertain when no report arrives; the
      // person's retry delivers again and this computer answers from its record.
      this.dependencies.logger.error('agent_session.continuation.startup_unreported', {
        ...fields,
        error: safeDetail(error),
        code: error instanceof AgentSessionRunnerError ? error.code : null,
      });
    }
  }

  private async decide(input: ContinuationStartupInput): Promise<StartupDecision> {
    const session = await this.dependencies.runStore.getRunMetadata(input.agentSessionId);
    if (!session || session.conversationId !== input.conversationId) {
      return { outcome: 'FAILED', reasonCode: 'RUN_NOT_MATERIALIZED' };
    }
    return input.marker.mode === 'NATIVE_RESUME'
      ? this.decideNativeResume(session)
      : this.decideSavedHistory(session, input.marker);
  }

  private async decideNativeResume(session: AgenticSession): Promise<StartupDecision> {
    const local = await this.dependencies.inspector.classify(session.agentic_session_id, {
      conversationId: session.conversationId,
      provider: session.provider,
    });
    if (local.nativeState !== 'USABLE') {
      return { outcome: 'NATIVE_RESUME_REJECTED', reasonCode: local.reason };
    }
    try {
      await this.dependencies.providers.resumeProviderSessionWithoutPrompt(session);
      return { outcome: 'RESUMED' };
    } catch (error) {
      if (error instanceof AgentSessionRunnerError && RESUME_UNAVAILABLE_CODES.has(error.code)) {
        return { outcome: 'NATIVE_RESUME_REJECTED', reasonCode: `PROVIDER_${error.code}` };
      }
      // Network, login and provider faults keep their own cause; they are not
      // evidence that the original session is gone.
      return {
        outcome: 'FAILED',
        reasonCode:
          error instanceof AgentSessionRunnerError
            ? `PROVIDER_${error.code}`
            : 'PROVIDER_RESUME_FAILED',
        detail: safeDetail(error),
      };
    }
  }

  private async decideSavedHistory(
    session: AgenticSession,
    marker: AgentSessionContinuationMarker,
  ): Promise<StartupDecision> {
    const staged = (session.memos ?? []).some(
      (memo) =>
        memo.source === CONTINUATION_MEMO_SOURCE &&
        memo.content.includes(`continuation:${marker.continuationId}`),
    );
    if (!staged) {
      return { outcome: 'FAILED', reasonCode: 'HISTORY_NOT_STAGED' };
    }
    if (session.provider_session_id) {
      return { outcome: 'FAILED', reasonCode: 'PREVIOUS_PROVIDER_SESSION_RETAINED' };
    }
    if (!(await this.dependencies.providers.isProviderAvailable(session.provider))) {
      return { outcome: 'FAILED', reasonCode: 'PROVIDER_UNAVAILABLE', detail: session.provider };
    }
    return { outcome: 'PREPARED_FROM_HISTORY' };
  }

  private async report(
    input: ContinuationStartupInput,
    report: AgentSessionContinuationStartupReport,
  ): Promise<void> {
    const { logger } = this.dependencies;
    const wait = this.dependencies.sleep ?? sleep;
    const fields = {
      runId: input.agentSessionId,
      continuationId: input.marker.continuationId,
      deliveryOperationId: input.deliveryOperationId,
      outcome: report.outcome,
    };
    for (let attempt = 1; attempt <= REPORT_ATTEMPTS; attempt += 1) {
      try {
        const api = await this.machineApi();
        const response = await api.reportAgentSessionContinuationStartup({
          organizationId: input.organizationId,
          projectId: input.projectId,
          agentSessionId: input.agentSessionId,
          continuationId: input.marker.continuationId,
          agentSessionContinuationStartupReport: report,
        });
        const answer = response.data.data;
        logger.info('agent_session.continuation.startup_reported', {
          ...fields,
          attempt,
          accepted: answer?.accepted ?? null,
          state: answer?.state ?? null,
        });
        return;
      } catch (error) {
        const status = httpStatusOf(error);
        const retryable = status === null || status >= 500;
        logger.warn('agent_session.continuation.startup_report_failed', {
          ...fields,
          attempt,
          status,
          retryable,
          error: safeDetail(error),
        });
        if (!retryable || attempt === REPORT_ATTEMPTS) {
          throw error;
        }
        await wait(REPORT_BACKOFF_MS * attempt);
      }
    }
  }

  private async machineApi(): Promise<AgentSessionsApi> {
    const { keyPairStore, apiBaseUrl } = this.dependencies;
    const machineId = await keyPairStore.loadCurrentMachineId();
    const credential = machineId ? await keyPairStore.loadMachineCredential(machineId) : null;
    if (!credential) {
      throw new Error('This computer has no machine credential to report with.');
    }
    return new AgentSessionsApi(
      new Configuration({ accessToken: credential, basePath: apiBaseUrl }),
    );
  }

  private recordPath(continuationId: string): string {
    return path.join(this.recordsDirectory, `${continuationId}.json`);
  }

  private async readRecord(marker: AgentSessionContinuationMarker): Promise<StartupRecord | null> {
    const raw = await readJsonFile<unknown>(this.recordPath(marker.continuationId), null);
    if (raw === null) {
      return null;
    }
    const parsed = recordSchema.safeParse(raw);
    if (!parsed.success) {
      this.dependencies.logger.warn('agent_session.continuation.startup_record_unreadable', {
        continuationId: marker.continuationId,
      });
      return null;
    }
    // A record for the other mode answers a different question; probe again.
    return parsed.data.mode === marker.mode ? parsed.data : null;
  }

  private async writeRecord(
    marker: AgentSessionContinuationMarker,
    outcome: AgentSessionContinuationStartupOutcome,
  ): Promise<void> {
    const record = recordSchema.parse({
      continuationId: marker.continuationId,
      mode: marker.mode,
      outcome,
      decidedAt: new Date().toISOString(),
    });
    await writeJsonFileAtomic(this.recordPath(marker.continuationId), record);
  }
}
