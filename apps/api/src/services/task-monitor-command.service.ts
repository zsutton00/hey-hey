import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  MonitorCommandBody,
  TaskMonitorExternalCommand,
  TaskMonitorAuthorityNeutralRequestCommand,
  ExecutableEnvelopeAuthorization,
  SubmitTaskMonitorCommandRequestDto,
  SubmitTaskMonitorCommandResponseDto,
} from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import { TriggerEmitter } from '../core/websockets/trigger-emitter.service';
import { MachineId, OrganizationId, ProjectId, TaskId, UserId } from '../types';
import { TaskMonitorJudgmentResponseService } from './task-monitor-judgment-response.service';
import { ExecutionGrantService } from './controller-authorization/execution-grant.service';

const COMMAND_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class TaskMonitorCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly triggerEmitter: TriggerEmitter,
    private readonly judgmentResponseService: TaskMonitorJudgmentResponseService,
    private readonly executionGrantService: ExecutionGrantService,
  ) {}

  async submit(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    monitorId: TaskId;
    userId: UserId;
    controllerBindingSecret?: string;
    request: SubmitTaskMonitorCommandRequestDto;
  }): Promise<SubmitTaskMonitorCommandResponseDto> {
    const { organizationId, projectId, monitorId, userId, request } = params;
    const existing = await this.prisma.db.monitorCommand.findUnique({
      where: {
        userId_requestId: { userId, requestId: request.requestId },
      },
    });
    if (existing) {
      this.assertRetryMatches(
        existing,
        organizationId,
        projectId,
        monitorId,
        request,
      );
      if (this.isAuthorityIncreasing(request.command)) {
        if (!('authorization' in request) || !request.authorization) {
          throw new ForbiddenException(
            'Exact controller authorization is required',
          );
        }
        await this.executionGrantService.admitTaskMonitorCommand({
          authorization: request.authorization,
          organizationId,
          projectId,
          monitorId,
          userId,
          controllerBindingSecret: params.controllerBindingSecret,
          requestId: request.requestId,
          command: request.command,
          ...(request.machineId
            ? { machineId: request.machineId as MachineId }
            : {}),
        });
      }
      if (request.command.cause === 'JUDGMENT_RESOLVED') {
        await this.judgmentResponseService.prepareAndEnsureResponse({
          commandId: existing.id,
          organizationId,
          projectId,
          monitorId,
          userId,
          command: request.command,
        });
      }
      return this.triggerEmitter.deliverMonitorCommand(existing.id);
    }

    const monitor = await this.prisma.db.task.findFirst({
      where: {
        id: monitorId,
        organizationId,
        projectId,
        type: 'TASK_MONITOR',
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!monitor) {
      throw new NotFoundException('Task Monitor not found');
    }

    let authorizedMachineId: MachineId | undefined;
    let admittedAuthorizationId: string | undefined;
    let admittedEnvelopeAuthorization:
      | ExecutableEnvelopeAuthorization
      | undefined;
    if (this.isAuthorityIncreasing(request.command)) {
      if (!('authorization' in request) || !request.authorization) {
        throw new ForbiddenException(
          'Exact controller authorization is required',
        );
      }
      const admitted = await this.executionGrantService.admitTaskMonitorCommand(
        {
          authorization: request.authorization,
          organizationId,
          projectId,
          monitorId,
          userId,
          controllerBindingSecret: params.controllerBindingSecret,
          requestId: request.requestId,
          command: request.command,
          ...(request.machineId
            ? { machineId: request.machineId as MachineId }
            : {}),
        },
      );
      authorizedMachineId = admitted.machineId;
      admittedAuthorizationId = admitted.grant.authorizationId;
      admittedEnvelopeAuthorization = admitted.envelopeAuthorization;
    } else if (this.isAuthorityReduction(request.command)) {
      await this.executionGrantService.reduceTaskMonitorAuthority({
        organizationId,
        projectId,
        monitorId,
        userId,
        command: request.command,
      });
    }

    const machine = authorizedMachineId
      ? { id: authorizedMachineId }
      : request.machineId
        ? await this.prisma.db.machine.findFirst({
            where: {
              id: request.machineId,
              userId,
              revokedAt: null,
              authorizationProtocolVersion: 2,
              authorizationState: 'READY',
              controllerCredentials: { some: { revokedAt: null } },
            },
            select: { id: true },
          })
        : await this.prisma.db.machine.findFirst({
            where: {
              userId,
              revokedAt: null,
              authorizationProtocolVersion: 2,
              authorizationState: 'READY',
              controllerCredentials: { some: { revokedAt: null } },
            },
            orderBy: { pairedAt: 'desc' },
            select: { id: true },
          });
    if (!machine) {
      if (request.machineId) {
        throw new ForbiddenException(
          'The selected machine is not active or is not owned by the current user',
        );
      }
      throw new BadRequestException('No active paired machine is available');
    }

    const judgmentContext =
      request.command.cause === 'JUDGMENT_RESOLVED'
        ? await this.judgmentResponseService.validateRequest({
            organizationId,
            projectId,
            monitorId,
            userId,
            command: request.command,
          })
        : undefined;

    const commandId = randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + COMMAND_TTL_MS);
    const durableCommand = this.toDurableCommand(
      request.command,
      userId,
      createdAt,
    );
    const body: MonitorCommandBody = {
      version: MonitorCommandBody.VersionEnum.NUMBER_1,
      kind: MonitorCommandBody.KindEnum.TaskMonitorCommand,
      commandId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      organizationId,
      projectId,
      target: { workItemType: 'TASK_MONITOR', workItemId: monitorId },
      command: durableCommand,
    };

    try {
      await this.prisma.db.monitorCommand.create({
        data: {
          id: commandId,
          requestId: request.requestId,
          authorizationId: admittedAuthorizationId,
          authorization: admittedEnvelopeAuthorization
            ? (admittedEnvelopeAuthorization as unknown as Prisma.InputJsonValue)
            : undefined,
          organizationId,
          projectId,
          monitorId,
          userId,
          machineId: machine.id,
          body: body as Prisma.InputJsonValue,
          expiresAt,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.db.monitorCommand.findUniqueOrThrow({
          where: {
            userId_requestId: { userId, requestId: request.requestId },
          },
        });
        this.assertRetryMatches(
          raced,
          organizationId,
          projectId,
          monitorId,
          request,
        );
        if (request.command.cause === 'JUDGMENT_RESOLVED') {
          await this.judgmentResponseService.prepareAndEnsureResponse({
            commandId: raced.id,
            organizationId,
            projectId,
            monitorId,
            userId,
            command: request.command,
          });
        }
        return this.triggerEmitter.deliverMonitorCommand(raced.id);
      }
      throw error;
    }

    if (judgmentContext) {
      await this.judgmentResponseService.ensureResponse({
        commandId,
        organizationId,
        projectId,
        userId,
        context: judgmentContext,
      });
    }
    return this.triggerEmitter.deliverMonitorCommand(commandId);
  }

  private assertRetryMatches(
    record: {
      organizationId: string;
      projectId: string;
      monitorId: string;
      machineId: string;
      authorizationId: string | null;
      authorization: Prisma.JsonValue | null;
      body: Prisma.JsonValue;
    },
    organizationId: OrganizationId,
    projectId: ProjectId,
    monitorId: TaskId,
    request: SubmitTaskMonitorCommandRequestDto,
  ): void {
    const body = record.body as unknown as MonitorCommandBody;
    const persistedAdmissionAuthorization = this.toAdmissionAuthorization(
      record.authorization,
    );
    if (
      record.organizationId !== organizationId ||
      record.projectId !== projectId ||
      record.monitorId !== monitorId ||
      (request.machineId !== undefined &&
        record.machineId !== request.machineId) ||
      !isDeepStrictEqual(
        persistedAdmissionAuthorization,
        'authorization' in request ? request.authorization : null,
      ) ||
      !this.isRetryCommandMatch(body.command, request.command)
    ) {
      throw new BadRequestException(
        'requestId is already bound to a different monitor command',
      );
    }
  }

  private toAdmissionAuthorization(
    authorization: Prisma.JsonValue | null,
  ): Prisma.JsonValue | null {
    if (
      !authorization ||
      typeof authorization !== 'object' ||
      Array.isArray(authorization) ||
      authorization.kind !== 'controller_assertion' ||
      !Object.prototype.hasOwnProperty.call(authorization, 'grantId')
    ) {
      return authorization;
    }
    const { grantId: _serverGrantId, ...admissionAuthorization } =
      authorization;
    return admissionAuthorization;
  }

  private isAuthorityIncreasing(
    command:
      | SubmitTaskMonitorCommandRequestDto['command']
      | MonitorCommandBody['command'],
  ): command is Extract<
    MonitorCommandBody['command'],
    {
      cause: 'START' | 'RESUME' | 'JUDGMENT_RESOLVED' | 'CONTINUE' | 'COMPLETE';
    }
  > {
    return (
      command.cause === 'START' ||
      command.cause === 'RESUME' ||
      command.cause === 'JUDGMENT_RESOLVED' ||
      command.cause === 'CONTINUE' ||
      command.cause === 'COMPLETE'
    );
  }

  private isAuthorityReduction(
    command:
      | SubmitTaskMonitorCommandRequestDto['command']
      | MonitorCommandBody['command'],
  ): command is Extract<
    MonitorCommandBody['command'],
    { cause: 'PAUSE' | 'STOP' | 'HALT' }
  > {
    return (
      command.cause === 'PAUSE' ||
      command.cause === 'STOP' ||
      command.cause === 'HALT'
    );
  }

  private toDurableCommand(
    command: SubmitTaskMonitorCommandRequestDto['command'],
    userId: UserId,
    authenticatedAt: Date,
  ): TaskMonitorExternalCommand {
    if (command.cause !== 'HUMAN_DECISION') return command;
    return {
      ...command,
      human: {
        userId,
        authenticatedAt: authenticatedAt.toISOString(),
      },
    } satisfies TaskMonitorExternalCommand;
  }

  private isRetryCommandMatch(
    persisted: TaskMonitorExternalCommand,
    requested: SubmitTaskMonitorCommandRequestDto['command'],
  ): boolean {
    if (requested.cause !== 'HUMAN_DECISION') {
      return isDeepStrictEqual(persisted, requested);
    }
    if (persisted.cause !== 'HUMAN_DECISION') return false;
    const { human: _platformEvidence, ...persistedRequest } = persisted;
    return isDeepStrictEqual(
      persistedRequest,
      requested satisfies TaskMonitorAuthorityNeutralRequestCommand,
    );
  }
}
