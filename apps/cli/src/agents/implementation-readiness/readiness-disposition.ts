import type {
  ImplementationReadinessDisposition,
  ImplementationReadinessFinding,
  ImplementationReadinessResolution,
} from '../../shared/api/generated/api';
import type { AgenticSession } from '../../session/types';
import type { ServerLogger } from '../../server/logger';
import type { RunStore } from '../../run-store/run-store';
import {
  type ReadinessSourceRevisionInput,
  createReadinessSourceSnapshot,
} from './source-snapshot';
import {
  parseImplementationReadinessFromSessionContext,
  serializeImplementationReadinessToSessionContext,
  implementationReadinessDispositionSchema,
} from './session-context';

export const parseImplementationReadinessDisposition = (
  value: unknown,
): ImplementationReadinessDisposition => {
  return implementationReadinessDispositionSchema.parse(value);
};

export const allowsImplementation = (
  disposition: ImplementationReadinessDisposition | null,
): boolean => {
  if (!disposition) return true;
  if (disposition.state === 'CLEAR') return disposition.resolution.kind === 'NONE';
  if (disposition.state !== 'DISMISSED') return false;

  return (
    disposition.resolution.kind === 'DISMISSED' &&
    disposition.resolution.runId === disposition.sourceSnapshot.runId &&
    disposition.resolution.sourceRevision === disposition.sourceSnapshot.sourceRevision
  );
};

export const resolveDispositionForRun = (
  disposition: ImplementationReadinessDisposition,
  runId: string,
  sourceRevision: string,
  resolvedAt: string,
): ImplementationReadinessDisposition => {
  if (
    disposition.state !== 'REVIEW_REQUIRED' ||
    disposition.sourceSnapshot.runId !== runId ||
    disposition.sourceSnapshot.sourceRevision !== sourceRevision
  ) {
    throw new Error('Implementation-readiness action is stale or not awaiting review.');
  }
  const resolution: ImplementationReadinessResolution = {
    kind: 'DISMISSED',
    runId,
    sourceRevision,
    resolvedAt,
  };
  return { ...disposition, state: 'DISMISSED', resolution };
};

export class ImplementationReadinessOwner {
  public constructor(
    private readonly runStore: RunStore,
    private readonly logger: ServerLogger,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public read(session: AgenticSession): ImplementationReadinessDisposition | null {
    try {
      const disposition = parseImplementationReadinessFromSessionContext(session.sessionContext);
      this.logger.debug('local.run.implementation_readiness.read', {
        runId: session.agentic_session_id,
        state: disposition?.state ?? null,
      });
      return disposition;
    } catch (error) {
      this.logger.error('local.run.implementation_readiness.read_invalid', {
        runId: session.agentic_session_id,
        error,
      });
      throw error;
    }
  }

  public async persist(
    runId: string,
    disposition: ImplementationReadinessDisposition,
  ): Promise<void> {
    this.logger.debug('local.run.implementation_readiness.persist_begin', {
      runId,
      state: disposition.state,
      sourceRevision: disposition.sourceSnapshot.sourceRevision,
    });
    await this.runStore.updateRunImplementationReadiness(runId, disposition);
    this.logger.info('local.run.implementation_readiness.persisted', {
      runId,
      state: disposition.state,
      sourceRevision: disposition.sourceSnapshot.sourceRevision,
    });
  }

  public normalizeForSource(
    disposition: ImplementationReadinessDisposition,
    currentSnapshot: ReturnType<typeof createReadinessSourceSnapshot>,
  ): ImplementationReadinessDisposition {
    if (
      disposition.sourceSnapshot.runId !== currentSnapshot.runId ||
      disposition.sourceSnapshot.focalEntityId !== currentSnapshot.focalEntityId ||
      disposition.sourceSnapshot.focalEntityType !== currentSnapshot.focalEntityType
    ) {
      this.logger.error('local.run.implementation_readiness.source_identity_mismatch', {
        runId: currentSnapshot.runId,
        submittedRunId: disposition.sourceSnapshot.runId,
        submittedFocalEntityId: disposition.sourceSnapshot.focalEntityId,
        currentFocalEntityId: currentSnapshot.focalEntityId,
      });
      throw new Error('Implementation-readiness submission does not match this Run context.');
    }

    this.logger.debug('local.run.implementation_readiness.source_snapshot_normalized', {
      runId: currentSnapshot.runId,
      submittedSourceRevision: disposition.sourceSnapshot.sourceRevision,
      currentSourceRevision: currentSnapshot.sourceRevision,
    });
    return { ...disposition, sourceSnapshot: currentSnapshot };
  }

  public createSnapshot(input: ReadinessSourceRevisionInput) {
    return createReadinessSourceSnapshot({ ...input, capturedAt: input.capturedAt || this.now() });
  }

  public toSessionContext(
    disposition: ImplementationReadinessDisposition,
  ): Record<string, unknown> {
    return serializeImplementationReadinessToSessionContext(disposition);
  }
}
