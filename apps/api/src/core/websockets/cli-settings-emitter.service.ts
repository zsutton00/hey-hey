import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  CliSettingsDailySessionErrorResponseDto,
  CliSettingsDailySessionSuccessResponseDto,
  CliSettingsEnvelopeBody,
  CliSettingsErrorCode,
  CliSettingsRequestDto,
  CliSettingsResponseDto,
  WebSocketCliSettingsRequestEvent,
} from '../../generated';
import { MachineId, OrganizationId, ProjectId, UserId } from '../../types';
import { TriggerEnvelopeSigner } from './trigger-envelope-signer.service';
import { WebsocketGateway } from './websocket.gateway';

const genericErrorCodes = z.enum([
  'INVALID_REQUEST',
  'INVALID_PROJECT_CONTEXT',
  'SETTINGS_UNAVAILABLE',
  'PERSISTENCE_FAILED',
  'MACHINE_NOT_BOUND',
  'NO_RECIPIENT',
  'TIMEOUT',
  'CORRELATION_MISMATCH',
  'MALFORMED_ACK',
]);

const resourceSchema = z
  .object({
    settingsFamily: z.literal('daily_session'),
    schemaVersion: z.literal(1),
    scope: z
      .object({
        type: z.literal('project'),
        projectId: z
          .string()
          .uuid()
          .transform((value) => value as ProjectId),
      })
      .strict(),
    persistenceRevision: z.number().int().nonnegative(),
    effectiveValueSource: z.enum(['persisted', 'default']),
    value: z
      .object({
        enabled: z.boolean(),
        provider: z.enum(['claude', 'codex', 'opencode']),
        model: z.string().min(1),
        reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
        countThreshold: z.number().int().positive(),
        eventTypes: z.array(z.string().min(1)).min(1),
      })
      .strict(),
  })
  .strict();

const genericErrorSchema = z
  .object({ code: genericErrorCodes, message: z.string().min(1) })
  .strict();
const validationErrorSchema = z
  .object({
    code: z.literal('USER_SETTINGS_VALIDATION_FAILED'),
    message: z.string().min(1),
    issues: z.array(
      z.object({ path: z.string(), message: z.string() }).strict(),
    ),
  })
  .strict();
const revisionConflictErrorSchema = z
  .object({
    code: z.literal('USER_SETTINGS_REVISION_CONFLICT'),
    message: z.string().min(1),
    expectedPersistenceRevision: z.number().int().nonnegative(),
    currentPersistenceRevision: z.number().int().nonnegative(),
  })
  .strict();
const responseSchema = z.union([
  z
    .object({
      requestId: z.string().uuid(),
      operation: z.enum([
        'daily_session.settings.get',
        'daily_session.settings.replace',
      ]),
      status: z.literal('success'),
      result: resourceSchema,
    })
    .strict(),
  z
    .object({
      requestId: z.string().uuid(),
      operation: z.enum([
        'daily_session.settings.get',
        'daily_session.settings.replace',
      ]),
      status: z.literal('error'),
      error: z.union([
        genericErrorSchema,
        validationErrorSchema,
        revisionConflictErrorSchema,
      ]),
    })
    .strict(),
]);

const DEFAULT_CLI_SETTINGS_TIMEOUT_MS = 5_000;

@Injectable()
export class CliSettingsEmitter {
  private readonly logger = new Logger(CliSettingsEmitter.name);

  public constructor(
    private readonly signer: TriggerEnvelopeSigner,
    private readonly gateway: WebsocketGateway,
  ) {}

  public async request(params: {
    request: CliSettingsRequestDto;
    machineId: MachineId;
    userId: UserId;
    organizationId: OrganizationId;
    projectId: ProjectId;
    timeoutMs?: number;
  }): Promise<CliSettingsResponseDto> {
    const requestId = randomUUID();
    const body = {
      requestId,
      ...params.request,
    } satisfies CliSettingsEnvelopeBody;
    this.logger.log('[cli-settings] preparing signed request', {
      requestId,
      operation: body.operation,
      machineId: params.machineId,
      projectId: params.projectId,
    });
    const event: WebSocketCliSettingsRequestEvent = {
      type: WebSocketCliSettingsRequestEvent.TypeEnum.CliSettingsRequest,
      timestamp: new Date().toISOString(),
      organizationId: params.organizationId,
      projectId: params.projectId,
      userId: params.userId,
      envelope: this.signer.signCliSettings(
        body,
        params.machineId,
        params.userId,
      ),
    };
    const ack = await this.gateway.emitCliSettingsWithAck(
      event,
      params.timeoutMs ?? DEFAULT_CLI_SETTINGS_TIMEOUT_MS,
    );
    if (ack.kind === 'no_recipient') {
      return this.error(
        body,
        CliSettingsErrorCode.NoRecipient,
        'The bound CLI is not connected.',
      );
    }
    if (ack.kind === 'timeout') {
      return this.error(
        body,
        CliSettingsErrorCode.Timeout,
        'The bound CLI did not complete the settings operation before the timeout.',
      );
    }
    const acknowledgement = this.unwrapSingleAcknowledgement(ack.value);
    const parsed = responseSchema.safeParse(acknowledgement);
    if (!parsed.success) {
      this.logger.warn('[cli-settings] malformed acknowledgement', {
        requestId,
        issues: parsed.error.issues,
      });
      return this.error(
        body,
        CliSettingsErrorCode.MalformedAck,
        'The CLI returned a malformed settings acknowledgement.',
      );
    }
    if (
      parsed.data.requestId !== requestId ||
      parsed.data.operation !== body.operation
    ) {
      this.logger.warn('[cli-settings] acknowledgement correlation mismatch', {
        requestId,
        operation: body.operation,
        responseRequestId: parsed.data.requestId,
        responseOperation: parsed.data.operation,
      });
      return this.error(
        body,
        CliSettingsErrorCode.CorrelationMismatch,
        'The CLI acknowledgement did not match the settings request.',
      );
    }
    return parsed.data satisfies CliSettingsResponseDto;
  }

  public error(
    request: CliSettingsEnvelopeBody & { requestId?: string },
    code: CliSettingsErrorCode,
    message: string,
  ): CliSettingsDailySessionErrorResponseDto {
    return {
      requestId: request.requestId ?? randomUUID(),
      operation: request.operation,
      status: 'error',
      error: { code, message },
    };
  }

  private unwrapSingleAcknowledgement(value: unknown): unknown {
    if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
    return value;
  }
}
