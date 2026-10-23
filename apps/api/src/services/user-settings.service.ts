import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AgentSessionType,
  CliSettingsRequestDto,
  CliSettingsResponseDto,
  UserSettingsDailySessionReplacementRequestV1,
  UserSettingsFamily,
  UserSettingsResponse,
  UserSettingsRevisionConflictResponse,
  UserSettingsValidationErrorResponse,
} from '../generated';
import { MachineId, OrganizationId, ProjectId, UserId } from '../types';
import { CliSettingsEmitter } from '../core/websockets/cli-settings-emitter.service';
import { AgentSessionService } from './agent-session.service';

@Injectable()
export class UserSettingsService {
  private readonly logger = new Logger(UserSettingsService.name);

  public constructor(
    private readonly agentSessionService: AgentSessionService,
    private readonly cliSettingsEmitter: CliSettingsEmitter,
  ) {}

  public async get(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    settingsFamily: string,
  ): Promise<UserSettingsResponse> {
    const family = this.requireFamily(settingsFamily);
    const session = await this.findBoundDailySession(organizationId, projectId, userId);
    const response = await this.cliSettingsEmitter.request({
      request: { operation: 'daily_session.settings.get', projectId },
      machineId: session.machineId as MachineId,
      userId,
      organizationId,
      projectId,
    });
    return this.mapResponse(response, family, projectId);
  }

  public async replace(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    settingsFamily: string,
    request: UserSettingsDailySessionReplacementRequestV1,
  ): Promise<UserSettingsResponse> {
    const family = this.requireFamily(settingsFamily);
    if (
      request.settingsFamily !== family ||
      request.schemaVersion !== 1 ||
      request.scope.type !== 'project' ||
      request.scope.projectId !== projectId
    ) {
      throw this.httpError(HttpStatus.BAD_REQUEST, 'The settings payload is not bound to this project.');
    }
    const session = await this.findBoundDailySession(organizationId, projectId, userId);
    const cliRequest: CliSettingsRequestDto = {
      operation: 'daily_session.settings.replace',
      projectId,
      expectedPersistenceRevision: request.expectedPersistenceRevision,
      value: {
        enabled: request.value.enabled,
        provider: request.value.provider,
        model: request.value.model,
        reasoningEffort: request.value.reasoningEffort,
        countThreshold: request.value.countThreshold,
        eventTypes: [...request.value.eventTypes],
      },
    };
    const response = await this.cliSettingsEmitter.request({
      request: cliRequest,
      machineId: session.machineId as MachineId,
      userId,
      organizationId,
      projectId,
    });
    return this.mapResponse(response, family, projectId);
  }

  private async findBoundDailySession(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
  ) {
    this.logger.debug('user-settings.daily-session.lookup.started', {
      organizationId,
      projectId,
      userId,
      sessionType: AgentSessionType.DailySession,
    });
    const sessions = await this.agentSessionService.findAll(organizationId, projectId, {
      userId,
      type: AgentSessionType.DailySession,
    });
    const session = sessions.find((candidate) => candidate.userId === userId);
    if (!session) {
      throw this.httpError(HttpStatus.NOT_FOUND, 'No Daily Session is registered for this project.');
    }
    if (!session.machineId) {
      throw this.httpError(HttpStatus.SERVICE_UNAVAILABLE, 'The Daily Session CLI is not bound.');
    }
    this.logger.debug('user-settings.daily-session.lookup.completed', {
      organizationId,
      projectId,
      userId,
      agentSessionId: session.id,
      machineId: session.machineId,
    });
    return session;
  }

  private requireFamily(settingsFamily: string): UserSettingsFamily {
    if (settingsFamily !== 'daily_session') {
      throw this.httpError(HttpStatus.NOT_FOUND, 'The requested settings family does not exist.');
    }
    return 'daily_session';
  }

  private mapResponse(
    response: CliSettingsResponseDto,
    settingsFamily: UserSettingsFamily,
    projectId: ProjectId,
  ): UserSettingsResponse {
    if (response.status === 'success') {
      if (
        response.result.settingsFamily !== settingsFamily ||
        response.result.scope.type !== 'project' ||
        response.result.scope.projectId !== projectId
      ) {
        throw this.httpError(HttpStatus.BAD_GATEWAY, 'The CLI returned settings for the wrong project.');
      }
      return {
        success: true,
        message: 'User Settings retrieved successfully.',
        data: response.result,
        timestamp: new Date().toISOString(),
        statusCode: HttpStatus.OK,
      };
    }

    const error = response.error;
    this.logger.warn('user-settings.cli.rejected', {
      operation: response.operation,
      code: error.code,
      projectId,
    });
    if (error.code === 'USER_SETTINGS_VALIDATION_FAILED' && 'issues' in error) {
      const payload: UserSettingsValidationErrorResponse = {
        success: false,
        message: error.message,
        data: null,
        timestamp: new Date().toISOString(),
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'USER_SETTINGS_VALIDATION_FAILED',
        issues: error.issues,
      };
      throw new HttpException(payload, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (
      error.code === 'USER_SETTINGS_REVISION_CONFLICT' &&
      'expectedPersistenceRevision' in error &&
      'currentPersistenceRevision' in error
    ) {
      const payload: UserSettingsRevisionConflictResponse = {
        success: false,
        message: error.message,
        data: null,
        timestamp: new Date().toISOString(),
        statusCode: HttpStatus.CONFLICT,
        code: 'USER_SETTINGS_REVISION_CONFLICT',
        expectedPersistenceRevision: error.expectedPersistenceRevision,
        currentPersistenceRevision: error.currentPersistenceRevision,
      };
      throw new HttpException(payload, HttpStatus.CONFLICT);
    }
    const status =
      error.code === 'INVALID_REQUEST' || error.code === 'INVALID_PROJECT_CONTEXT'
        ? HttpStatus.BAD_REQUEST
        : error.code === 'MALFORMED_ACK' || error.code === 'CORRELATION_MISMATCH'
          ? HttpStatus.BAD_GATEWAY
          : HttpStatus.SERVICE_UNAVAILABLE;
    throw this.httpError(status, error.message);
  }

  private httpError(status: HttpStatus, message: string): HttpException {
    return new HttpException(
      {
        success: false,
        message,
        data: null,
        timestamp: new Date().toISOString(),
        statusCode: status,
      },
      status,
    );
  }
}
