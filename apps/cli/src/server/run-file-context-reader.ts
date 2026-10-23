import path from 'node:path';
import { projectFileChanges, resolveRunFilePath } from '../run/file-change-facts';
import type { CanonicalFileChangeFact } from '../run/file-change-facts';
import type { AgenticSession } from '../session/types';
import type { RunRegistry } from '../run/run-registry';
import type { RunStore } from '../run-store/run-store';
import { RunFamilyCompatibilityError } from '../run-store/run-family';
import type { ServerLogger } from './logger';

import { RunReadPreparationError } from './run-read-preparation-error';
import type { ProjectModeBundleRestorer } from '../agents/project-mode';
import type { ChangedFilesReadPhase } from './changed-files-read-diagnostics';
import { prepareRunIdentity } from './run-read-identity';

export interface RunFileContextReadOptions {
  onPhase?: (phase: ChangedFilesReadPhase) => void;
}

export class RunFileContextReader {
  public constructor(
    private readonly runStore: RunStore,
    private readonly runRegistry: RunRegistry,
    private readonly logger: ServerLogger,
    private readonly projectModeBundleRestorer?: ProjectModeBundleRestorer,
  ) {}

  /** Resolve file context without activating a Run or reading its event history. */
  public async read(runId: string, options: RunFileContextReadOptions = {}) {
    const { runStore, runRegistry, logger } = this;
    const registered = runRegistry.get(runId);
    if (registered) {
      options.onPhase?.('reuse');
      logger.debug('local.changed_files_read.registry_hit', { runId });
      await this.prepareSession(runId, registered.session);
      options.onPhase?.('membership_seed');
      await registered.ensureFileChangeFactsSeeded();
      return registered;
    }
    options.onPhase?.('restore');
    logger.debug('local.changed_files_read.loading', { runId });
    try {
      const args = await this.prepareSession(runId, await runStore.getRunMetadata(runId));
      const { facts, touchedFiles } = args.fileChangeSeed;
      const projection =
        facts.length > 0
          ? projectFileChanges(facts)
          : touchedFiles.map((entry) => {
              const resolved = resolveRunFilePath(args.session, entry);
              if (!resolved)
                throw new RunReadPreparationError(
                  'INVALID_FILE_MEMBERSHIP',
                  'Legacy file membership is outside its repositories.',
                );
              return { serviceId: resolved.serviceId, repoRelativePath: resolved.repoRelativePath };
            });
      logger.debug('local.changed_files_read.loaded', {
        runId,
        factCount: facts.length,
        projectionCount: projection.length,
      });
      return { ...args, getFileChangeProjection: () => projection };
    } catch (error) {
      logger.warn('local.changed_files_read.failed', {
        runId,
        errorName: error instanceof Error ? error.name : 'NonError',
      });
      if (error instanceof RunFamilyCompatibilityError) {
        throw new RunReadPreparationError('READ_FAILED', error.message, { cause: error });
      }
      throw error;
    }
  }

  public async prepareSession(runId: string, session: AgenticSession | null) {
    const { runStore } = this;
    const args = prepareRunIdentity(runId, session);
    const { session: resolvedSession } = args;
    session = resolvedSession;
    if (session.services.length === 0) {
      throw new RunReadPreparationError(
        'SERVICE_NOT_FOUND',
        'The persisted Run has no service context.',
      );
    }
    if (
      !session.launchServiceId ||
      !session.services.some((service) => service.id === session.launchServiceId)
    ) {
      throw new RunReadPreparationError(
        'SERVICE_NOT_FOUND',
        'The persisted Run launch service is missing from its service context.',
      );
    }
    for (const service of session.services) {
      if (!service.id.trim() || !service.path.trim()) {
        throw new RunReadPreparationError(
          'SERVICE_NOT_FOUND',
          'The persisted Run contains an incomplete service binding.',
        );
      }
      if (!path.isAbsolute(service.path)) {
        throw new RunReadPreparationError(
          'INVALID_REPOSITORY_PATH',
          `Repository path for service ${service.id} is not absolute.`,
        );
      }
    }

    let facts: CanonicalFileChangeFact[];
    let touchedFiles: string[];
    try {
      [facts, touchedFiles] = await Promise.all([
        runStore.getFileChangeFacts(runId),
        runStore.getTouchedFiles(runId),
      ]);
    } catch (error) {
      throw new RunReadPreparationError(
        'READ_FAILED',
        error instanceof RunFamilyCompatibilityError
          ? error.message
          : 'Failed to preload durable file membership.',
        { cause: error },
      );
    }
    for (const fact of facts) {
      if (
        fact.runId !== runId ||
        !session.services.some((service) => service.id === fact.serviceId) ||
        !fact.repoRelativePath ||
        path.posix.isAbsolute(fact.repoRelativePath) ||
        fact.repoRelativePath.split('/').includes('..')
      ) {
        throw new RunReadPreparationError(
          'INVALID_FILE_MEMBERSHIP',
          'The persisted Run contains invalid canonical file membership.',
        );
      }
    }
    if (facts.length === 0 && touchedFiles.some((entry) => !resolveRunFilePath(session, entry))) {
      throw new RunReadPreparationError(
        'INVALID_FILE_MEMBERSHIP',
        'The persisted Run contains legacy file membership outside its repositories.',
      );
    }

    await this.projectModeBundleRestorer?.restore(args.session);

    return { ...args, fileChangeSeed: { facts, touchedFiles } };
  }
}
