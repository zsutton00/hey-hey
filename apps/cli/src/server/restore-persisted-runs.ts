import type { Run } from '../run/run';
import type { RunRegistry } from '../run/run-registry';
import type { RunStore } from '../run-store/run-store';
import { RunFamilyCompatibilityError } from '../run-store/run-family';
import type { ServerLogger } from './logger';
import { RunFileContextReader } from './run-file-context-reader';
import { prepareRunIdentity } from './run-read-identity';
import { RunReadPreparationError } from './run-read-preparation-error';
import type { ProjectModeBundleRestorer } from '../agents/project-mode';
export { RunReadPreparationError } from './run-read-preparation-error';

export interface RunReadRestoreCoordinatorDependencies {
  runStore: RunStore;
  runRegistry: RunRegistry;
  logger: ServerLogger;
  projectModeBundleRestorer?: ProjectModeBundleRestorer;
}

export class RunReadRestoreCoordinator {
  private readonly inFlight = new Map<string, Promise<Run>>();
  private readonly identityInFlight = new Map<string, Promise<Run>>();

  private readonly fileContextReader: RunFileContextReader;

  public constructor(private readonly dependencies: RunReadRestoreCoordinatorDependencies) {
    this.fileContextReader = new RunFileContextReader(
      dependencies.runStore,
      dependencies.runRegistry,
      dependencies.logger,
      dependencies.projectModeBundleRestorer,
    );
  }

  public restore(runId: string): Promise<Run> {
    const existing = this.inFlight.get(runId);
    if (existing) {
      this.dependencies.logger.debug('local.run_read_restore.coalesced', { runId });
      return existing;
    }
    const restoration = this.restoreOnce(runId).finally(() => {
      this.inFlight.delete(runId);
    });
    this.inFlight.set(runId, restoration);
    return restoration;
  }

  /**
   * Restore the Run identity without validating repository file context. The
   * Run still seeds its own durable file membership, so a later Turn (e.g.
   * Commit) sees the same canonical file set as changed-file reads.
   */
  public restoreIdentity(runId: string): Promise<Run> {
    const existing = this.identityInFlight.get(runId);
    if (existing) {
      this.dependencies.logger.debug('local.run_identity_restore.coalesced', { runId });
      return existing;
    }
    const restoration = this.restoreIdentityOnce(runId).finally(() => {
      this.identityInFlight.delete(runId);
    });
    this.identityInFlight.set(runId, restoration);
    return restoration;
  }

  /** Compatibility entry point for the context-usage reader. */
  public restoreForContextUsage(runId: string): Promise<Run> {
    return this.restoreIdentity(runId);
  }

  private async restoreIdentityOnce(runId: string): Promise<Run> {
    const { runStore, runRegistry, logger } = this.dependencies;
    const registered = runRegistry.get(runId);
    if (registered) {
      logger.debug('local.run_identity_restore.registry_hit', { runId });
      return registered;
    }

    logger.info('local.run_identity_restore.loading', { runId });
    let session;
    try {
      session = await runStore.getRun(runId);
    } catch (error) {
      if (error instanceof RunFamilyCompatibilityError) {
        throw new RunReadPreparationError('READ_FAILED', error.message, { cause: error });
      }
      throw error;
    }
    const args = prepareRunIdentity(runId, session);
    const run = runRegistry.create(args);
    logger.info('local.run_identity_restore.completed', { runId });
    return run;
  }

  private async restoreOnce(runId: string): Promise<Run> {
    const { runStore, runRegistry, logger } = this.dependencies;
    const registered = runRegistry.get(runId);
    if (registered) {
      logger.debug('local.run_read_restore.registry_hit', { runId });
      await registered.ensureFileChangeFactsSeeded();
      return registered;
    }

    logger.info('local.run_read_restore.loading', { runId });
    let session;
    try {
      session = await runStore.getRun(runId);
    } catch (error) {
      if (error instanceof RunFamilyCompatibilityError) {
        throw new RunReadPreparationError('READ_FAILED', error.message, { cause: error });
      }
      throw error;
    }
    const args = await this.fileContextReader.prepareSession(runId, session);
    const { facts, touchedFiles } = args.fileChangeSeed;
    const run = runRegistry.create({
      ...args,
    });
    try {
      await run.ensureFileChangeFactsSeeded();
      logger.info('local.run_read_restore.completed', {
        runId,
        factCount: facts.length,
        touchedFileCount: touchedFiles.length,
      });
      return run;
    } catch (error) {
      runRegistry.remove(runId, run);
      throw new RunReadPreparationError('READ_FAILED', 'Failed to register the restored Run.', {
        cause: error,
      });
    }
  }
}
