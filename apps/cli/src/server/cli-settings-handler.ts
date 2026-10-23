import type {
  CliSettingsDailySessionErrorResponseDto,
  CliSettingsDailySessionSuccessResponseDto,
  CliSettingsEnvelopeBody,
  CliSettingsGenericError,
  CliSettingsResponseDto,
  UserSettingsDailySessionResourceV1,
} from '../shared/api/generated/api';
import type { PlatformAuthContext } from './platform-auth-context';
import {
  DailySessionSettingsRevisionConflictError,
  DailySessionSettingsStore,
  DailySessionSettingsValidationError,
  type DailySessionSettingsSnapshot,
} from './monitors/daily-session-settings';
import type { MonitorPipeline } from './monitors';
import type { ServerLogger } from './logger';
import type { TriggerVerificationRuntime } from './trigger-verification/trigger-verification-runtime';

/** Owns the verified, project-bound User Settings command lifecycle. */
export class CliSettingsHandler {
  public constructor(private readonly dependencies: CliSettingsHandlerDependencies) {}

  public async handle(rawFrame: unknown): Promise<CliSettingsResponseDto | null> {
    const { logger, triggerVerificationRuntime } = this.dependencies;
    const verification = triggerVerificationRuntime.verifyCliSettingsFrame(rawFrame);
    if (!verification) {
      logger.warn('cli-settings.frame.dropped', { reason: 'verifier_not_ready' });
      return null;
    }
    if (!verification.ok) {
      logger.warn('cli-settings.frame.dropped', {
        reason: verification.reason,
        details: verification.details,
      });
      return null;
    }

    const { body, frame } = verification.verified;
    logger.info('cli-settings.operation.started', {
      requestId: body.requestId,
      operation: body.operation,
      projectId: body.projectId,
    });

    if (frame.projectId !== body.projectId) {
      return this.error(body, {
        code: 'INVALID_PROJECT_CONTEXT',
        message: 'The signed project does not match the settings project.',
      });
    }

    const auth = await this.dependencies.authContext.resolve();
    if (
      !auth ||
      auth.organizationId !== frame.organizationId ||
      auth.projectId !== body.projectId
    ) {
      logger.warn('cli-settings.operation.rejected', {
        requestId: body.requestId,
        reason: 'project_context_unavailable_or_mismatched',
        projectId: body.projectId,
      });
      return this.error(body, {
        code: 'SETTINGS_UNAVAILABLE',
        message: 'The CLI does not have an active authenticated project context.',
      });
    }

    try {
      const snapshot =
        body.operation === 'daily_session.settings.get'
          ? await this.dependencies.settingsStore.load(body.projectId)
          : await this.replace(body.projectId, body.expectedPersistenceRevision, body.value);
      if (snapshot.status === 'invalid') {
        return this.error(body, {
          code: 'SETTINGS_UNAVAILABLE',
          message: snapshot.issues.join('; '),
        });
      }
      logger.info('cli-settings.operation.completed', {
        requestId: body.requestId,
        operation: body.operation,
        projectId: body.projectId,
        persistenceRevision: snapshot.persistenceRevision,
        effectiveValueSource: snapshot.effectiveValueSource,
      });
      return this.success(body, body.projectId, snapshot);
    } catch (error) {
      logger.error('cli-settings.operation.failed', {
        requestId: body.requestId,
        operation: body.operation,
        projectId: body.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof DailySessionSettingsValidationError) {
        return this.error(body, {
          code: 'USER_SETTINGS_VALIDATION_FAILED',
          message: error.message,
          issues: error.issues.map((issue) => ({ path: 'settings', message: issue })),
        });
      }
      if (error instanceof DailySessionSettingsRevisionConflictError) {
        return this.error(body, {
          code: 'USER_SETTINGS_REVISION_CONFLICT',
          message: error.message,
          expectedPersistenceRevision: error.expectedPersistenceRevision,
          currentPersistenceRevision: error.currentPersistenceRevision,
        });
      }
      return this.error(body, {
        code: 'PERSISTENCE_FAILED',
        message: 'The CLI could not complete the settings operation.',
      });
    }
  }

  private async replace(
    projectId: string,
    expectedPersistenceRevision: number,
    value: Extract<CliSettingsEnvelopeBody, { operation: 'daily_session.settings.replace' }>['value'],
  ): Promise<DailySessionSettingsSnapshot> {
    const snapshot = await this.dependencies.settingsStore.replace(
      projectId,
      expectedPersistenceRevision,
      value,
    );
    this.dependencies.monitorPipeline.applyDailySessionSettings(snapshot.settings);
    return snapshot;
  }

  private success(
    body: CliSettingsEnvelopeBody,
    projectId: string,
    snapshot: DailySessionSettingsSnapshot,
  ): CliSettingsDailySessionSuccessResponseDto {
    return {
      requestId: body.requestId,
      operation: body.operation,
      status: 'success',
      result: this.toResource(projectId, snapshot),
    };
  }

  private error(
    body: CliSettingsEnvelopeBody,
    error: Extract<CliSettingsResponseDto, { status: 'error' }>['error'],
  ): CliSettingsDailySessionErrorResponseDto {
    return {
      requestId: body.requestId,
      operation: body.operation,
      status: 'error',
      error,
    };
  }

  private toResource(
    projectId: string,
    snapshot: DailySessionSettingsSnapshot,
  ): UserSettingsDailySessionResourceV1 {
    return {
      settingsFamily: 'daily_session',
      schemaVersion: 1,
      scope: { type: 'project', projectId },
      persistenceRevision: snapshot.persistenceRevision,
      effectiveValueSource: snapshot.effectiveValueSource,
      value: {
        enabled: snapshot.settings.enabled,
        provider: snapshot.settings.provider,
        model: snapshot.settings.model,
        reasoningEffort: snapshot.settings.reasoningEffort,
        countThreshold: snapshot.settings.countThreshold,
        eventTypes: [...snapshot.settings.eventTypes],
      },
    };
  }
}

export interface CliSettingsHandlerDependencies {
  triggerVerificationRuntime: TriggerVerificationRuntime;
  settingsStore: DailySessionSettingsStore;
  monitorPipeline: MonitorPipeline;
  authContext: PlatformAuthContext;
  logger: ServerLogger;
}
