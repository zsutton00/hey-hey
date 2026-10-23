import * as crypto from 'node:crypto';
import {
  Body,
  ConflictException,
  Controller,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ModuleRef } from '@nestjs/core';
import { CurrentMachine } from '../auth/decorators/current-machine.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { MachineCredentialGuard } from '../auth/guards/machine-credential.guard';
import { canonicalizeJcs } from '../core/websockets/trigger-canonicalization';
import {
  ConversationStartRunRequestDto,
  MachineEffectHttpMethod,
  MessageStatus,
  MessageType,
  SubmitExecutableUserMessageRequestDto,
  SubmitTaskMonitorGuidanceEffectRequestDto,
  SubmitTaskMonitorGuidanceEffectResponseDto,
  SubmitTaskMonitorRunEffectRequestDto,
  SubmitTaskMonitorRunEffectResponseDto,
  UserMessageAgentInputProvenance,
  UserMessageDataCodingFreeform,
} from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import { MachineEffectAdmissionService } from '../services/machine-effect-admission/machine-effect-admission.service';
import type { AuthenticatedMachine } from '../services/machine-pairing/machine-pairing.service';
import { ExecutionGrantService } from '../services/controller-authorization/execution-grant.service';
import {
  AgentSessionId,
  ConversationId,
  MachineId,
  OrganizationId,
  ProjectId,
  TaskId,
} from '../types';
import { ConversationController } from './conversation.controller';
import { MessageController } from './message.controller';

const RUN_OPERATION = 'submitTaskMonitorRunEffect';
const GUIDANCE_OPERATION = 'submitTaskMonitorGuidanceEffect';

@Public()
@UseGuards(MachineCredentialGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/machines/:machineId/task-monitors/:taskMonitorId/commands/:commandId',
)
export class TaskMonitorMachineEffectController {
  private readonly logger = new Logger(TaskMonitorMachineEffectController.name);

  constructor(
    private readonly machineEffectAdmission: MachineEffectAdmissionService,
    private readonly executionGrantService: ExecutionGrantService,
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaService,
  ) {}

  @Post('conversations/:conversationId/run-effects')
  async submitRun(
    @Param('organizationId', ParseUUIDPipe) organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('machineId', ParseUUIDPipe) addressedMachineId: MachineId,
    @Param('taskMonitorId', ParseUUIDPipe) taskMonitorId: TaskId,
    @Param('commandId', ParseUUIDPipe) commandId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: ConversationId,
    @Body() input: SubmitTaskMonitorRunEffectRequestDto,
    @CurrentMachine() authenticatedMachine: AuthenticatedMachine,
    @Req() request: Request,
  ): Promise<SubmitTaskMonitorRunEffectResponseDto> {
    const semanticRequest = { run: input.run } satisfies Omit<
      SubmitTaskMonitorRunEffectRequestDto,
      'proof'
    >;
    const admitted = await this.machineEffectAdmission.admit({
      authenticatedMachine,
      proof: input.proof,
      operationId: RUN_OPERATION,
      method: MachineEffectHttpMethod.Post,
      path: request.originalUrl,
      payload: semanticRequest,
    });
    this.assertMachineBindings(
      admitted.machineId,
      addressedMachineId,
      input.run.machineId as MachineId,
    );
    this.assertRunContext(
      input,
      admitted.effectId,
      organizationId,
      projectId,
      taskMonitorId,
    );
    const executionAdmission =
      await this.executionGrantService.assertTaskMonitorMachineEffectAuthorized(
        {
          commandId,
          organizationId,
          projectId,
          monitorId: taskMonitorId,
          machineId: admitted.machineId,
          userId: admitted.userId,
          agentSessionId: input.run.agentSessionId as AgentSessionId,
          conversationId,
        },
      );
    const requestDto = {
      ...input.run,
      authorization: executionAdmission.envelopeAuthorization,
    } satisfies ConversationStartRunRequestDto;
    this.logger.log('Dispatching admitted Task Monitor run effect', {
      commandId,
      effectId: admitted.effectId,
      operationId: input.run.operationId,
      taskMonitorId,
      machineId: admitted.machineId,
      conversationId,
      agentSessionId: input.run.agentSessionId,
    });
    return this.moduleRef
      .get(ConversationController, { strict: false })
      .startConversationRun(
        projectId,
        conversationId,
        organizationId,
        admitted.userId,
        requestDto,
        undefined,
        executionAdmission,
      );
  }

  @Post(
    'agent-sessions/:agentSessionId/conversations/:conversationId/guidance-effects',
  )
  async submitGuidance(
    @Param('organizationId', ParseUUIDPipe) organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('machineId', ParseUUIDPipe) addressedMachineId: MachineId,
    @Param('taskMonitorId', ParseUUIDPipe) taskMonitorId: TaskId,
    @Param('commandId', ParseUUIDPipe) commandId: string,
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: AgentSessionId,
    @Param('conversationId', ParseUUIDPipe) conversationId: ConversationId,
    @Body() input: SubmitTaskMonitorGuidanceEffectRequestDto,
    @CurrentMachine() authenticatedMachine: AuthenticatedMachine,
    @Req() request: Request,
  ): Promise<SubmitTaskMonitorGuidanceEffectResponseDto> {
    const { proof, ...semanticRequest } = input;
    const admitted = await this.machineEffectAdmission.admit({
      authenticatedMachine,
      proof,
      operationId: GUIDANCE_OPERATION,
      method: MachineEffectHttpMethod.Post,
      path: request.originalUrl,
      payload: semanticRequest,
    });
    this.assertMachineBindings(
      admitted.machineId,
      addressedMachineId,
      addressedMachineId,
    );
    const executionAdmission =
      await this.executionGrantService.assertTaskMonitorMachineEffectAuthorized(
        {
          commandId,
          organizationId,
          projectId,
          monitorId: taskMonitorId,
          machineId: admitted.machineId,
          userId: admitted.userId,
          agentSessionId,
          conversationId,
        },
      );
    const message = {
      type: MessageType.User,
      conversationId,
      userId: admitted.userId,
      status: MessageStatus.Completed,
      projectId,
      agentSessionId,
      data: {
        agentInput: {
          promptType:
            UserMessageDataCodingFreeform.PromptTypeEnum.CodingFreeform,
          userMessage: input.guidance,
          provenance: UserMessageAgentInputProvenance.TaskMonitor,
        },
      },
    } as const;
    const operationFingerprint = crypto
      .createHash('sha256')
      .update(
        canonicalizeJcs({
          kind: 'DIRECT_TRIGGER',
          organizationId,
          projectId,
          message,
        }),
        'utf8',
      )
      .digest('hex');
    const requestDto = {
      ...message,
      operationId: admitted.effectId,
      operationFingerprint,
      authorization: executionAdmission.envelopeAuthorization,
    } satisfies SubmitExecutableUserMessageRequestDto;
    const existing = await this.prisma.db.agentOperation.findUnique({
      where: { operationId: admitted.effectId },
      select: { operationId: true },
    });
    this.logger.log('Persisting admitted Task Monitor guidance effect', {
      commandId,
      effectId: admitted.effectId,
      operationId: admitted.effectId,
      taskMonitorId,
      machineId: admitted.machineId,
      conversationId,
      agentSessionId,
    });
    await this.moduleRef
      .get(MessageController, { strict: false })
      .postMessage(
        projectId,
        organizationId,
        admitted.userId,
        requestDto,
        undefined,
        executionAdmission,
      );
    const operation = await this.prisma.db.agentOperation.findUnique({
      where: { operationId: admitted.effectId },
      select: { messageId: true, triggerMessageId: true, fingerprint: true },
    });
    if (!operation?.messageId || !operation.triggerMessageId) {
      throw new ConflictException({
        code: 'TASK_MONITOR_GUIDANCE_CORRELATION_MISSING',
        message:
          'The committed guidance operation is missing message correlation.',
      });
    }
    return {
      operationId: admitted.effectId,
      operationFingerprint: operation.fingerprint,
      messageId: operation.messageId as import('../types').MessageId,
      triggerMessageId:
        operation.triggerMessageId as import('../types').MessageId,
      replayed: existing !== null,
    };
  }

  private assertMachineBindings(
    authenticatedMachineId: MachineId,
    addressedMachineId: MachineId,
    deliveryMachineId: MachineId,
  ): void {
    if (
      authenticatedMachineId !== addressedMachineId ||
      authenticatedMachineId !== deliveryMachineId
    ) {
      this.logger.warn(
        'Task Monitor machine effect rejected machine mismatch',
        {
          authenticatedMachineId,
          addressedMachineId,
          deliveryMachineId,
        },
      );
      throw new ConflictException({
        code: 'TASK_MONITOR_MACHINE_MISMATCH',
        message: 'Authenticated, addressed, and delivery machines must match.',
      });
    }
  }

  private assertRunContext(
    input: SubmitTaskMonitorRunEffectRequestDto,
    admittedEffectId: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    taskMonitorId: TaskId,
  ): void {
    if (
      input.run.operationId !== admittedEffectId ||
      input.run.contextMetadata.organizationId !== organizationId ||
      input.run.contextMetadata.projectId !== projectId ||
      input.run.contextMetadata.taskMonitorId !== taskMonitorId ||
      input.run.contextMetadata.agentSessionId !== input.run.agentSessionId
    ) {
      throw new ConflictException({
        code: 'TASK_MONITOR_RUN_CONTEXT_MISMATCH',
        message: 'Run context does not match the admitted Task Monitor effect.',
      });
    }
  }
}
