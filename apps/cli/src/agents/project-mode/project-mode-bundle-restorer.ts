import type { AgenticSession } from '../../session/types';
import type { ServerLogger } from '../../server/logger';
import { ProjectModeBundleMaterializer } from './project-mode-bundle-materializer';
import { hasCapturedProjectModeConfig, validateProjectModeConfig } from './project-mode-snapshot';

export class ProjectModeBundleRestorationError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProjectModeBundleRestorationError';
  }
}

/** Restores a persisted Run's captured project-mode files before activation. */
export class ProjectModeBundleRestorer {
  public constructor(
    private readonly materializer: ProjectModeBundleMaterializer,
    private readonly logger: ServerLogger,
  ) {}

  public async restore(session: AgenticSession): Promise<void> {
    const config = session.config;
    if (!hasCapturedProjectModeConfig(config)) {
      this.logger.debug('local.run_restore.project_mode_bundle.skipped', {
        runId: session.agentic_session_id,
        reason: 'captured_project_mode_config_absent',
      });
      return;
    }

    const validated = validateProjectModeConfig(config);
    if (!validated.ok) {
      this.logger.error('local.run_restore.project_mode_bundle.invalid_snapshot', {
        runId: session.agentic_session_id,
        issues: validated.issues,
      });
      throw new ProjectModeBundleRestorationError(
        `Persisted project-mode snapshot is invalid: ${validated.issues.join('; ')}`,
      );
    }

    try {
      const bundleDirectory = await this.materializer.materialize(
        session.agentic_session_id,
        validated.value.snapshot,
      );
      this.logger.info('local.run_restore.project_mode_bundle.ready', {
        runId: session.agentic_session_id,
        bundleDirectory,
        snapshotHash: validated.value.snapshot['snapshotHash'],
      });
    } catch (error) {
      this.logger.error('local.run_restore.project_mode_bundle.failed', {
        runId: session.agentic_session_id,
        snapshotHash: validated.value.snapshot['snapshotHash'],
        error,
      });
      throw new ProjectModeBundleRestorationError(
        'Failed to restore the persisted project-mode bundle.',
        { cause: error },
      );
    }
  }
}
