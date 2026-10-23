import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { ModuleRef } from '@nestjs/core';
import type {
  SubmitExecutableUserMessageRequestDto,
  SubmitTaskMonitorGuidanceEffectRequestDto,
} from '../../generated';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MachineEffectAdmissionService } from '../../services/machine-effect-admission/machine-effect-admission.service';
import type { ExecutionGrantService } from '../../services/controller-authorization/execution-grant.service';
import type { AuthenticatedMachine } from '../../services/machine-pairing/machine-pairing.service';
import type {
  AgentSessionId,
  ConversationId,
  MachineId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../../types';
import { ConversationController } from '../conversation.controller';
import type { MessageController } from '../message.controller';
import { TaskMonitorMachineEffectController } from '../task-monitor-machine-effect.controller';

const ids = {
  organization: '10000000-0000-4000-8000-000000000001' as OrganizationId,
  project: '20000000-0000-4000-8000-000000000002' as ProjectId,
  machine: '30000000-0000-4000-8000-000000000003' as MachineId,
  otherMachine: '40000000-0000-4000-8000-000000000004' as MachineId,
  monitor: '50000000-0000-4000-8000-000000000005' as TaskId,
  command: '60000000-0000-4000-8000-000000000006',
  session: '70000000-0000-4000-8000-000000000007' as AgentSessionId,
  conversation: '80000000-0000-4000-8000-000000000008' as ConversationId,
  user: '90000000-0000-4000-8000-000000000009' as UserId,
  effect: 'a0000000-0000-4000-8000-00000000000a',
};

const guidanceInput = {
  guidance: 'Address the failed acceptance check.',
  proof: {},
} as SubmitTaskMonitorGuidanceEffectRequestDto;

const authenticatedMachine: AuthenticatedMachine = {
  machineId: ids.machine,
  userId: ids.user,
};

const request = {
  originalUrl: `/api/v1/organizations/${ids.organization}/projects/${ids.project}/machines/${ids.machine}/task-monitors/${ids.monitor}/commands/${ids.command}/agent-sessions/${ids.session}/conversations/${ids.conversation}/guidance-effects`,
} as Request;

const harness = (admittedMachineId: MachineId = ids.machine) => {
  const machineEffectAdmission = {
    admit: jest.fn().mockResolvedValue({
      machineId: admittedMachineId,
      userId: ids.user,
      organizationId: ids.organization,
      effectId: ids.effect,
      operationId: 'submitTaskMonitorGuidanceEffect',
    }),
  };
  const executionGrantService = {
    assertTaskMonitorMachineEffectAuthorized: jest.fn().mockResolvedValue({
      envelopeAuthorization: { kind: 'bounded_grant', grantId: 'grant-1' },
    }),
  };
  const conversationController = { startConversationRun: jest.fn() };
  const messageController = { postMessage: jest.fn().mockResolvedValue({}) };
  const moduleRef = {
    get: jest.fn((token: object) =>
      token === ConversationController
        ? conversationController
        : messageController,
    ),
  };
  const findUnique = jest
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({
      messageId: 'b0000000-0000-4000-8000-00000000000b',
      triggerMessageId: 'c0000000-0000-4000-8000-00000000000c',
      fingerprint: 'd'.repeat(64),
    });
  const prisma = { db: { agentOperation: { findUnique } } };
  return {
    machineEffectAdmission,
    executionGrantService,
    messageController,
    controller: new TaskMonitorMachineEffectController(
      machineEffectAdmission as never as MachineEffectAdmissionService,
      executionGrantService as never as ExecutionGrantService,
      moduleRef as never as ModuleRef,
      prisma as never as PrismaService,
    ),
  };
};

describe(TaskMonitorMachineEffectController.name, () => {
  it('rejects an addressed-machine mismatch before grant or message effects', async () => {
    const { controller, executionGrantService, messageController } = harness(
      ids.otherMachine,
    );

    await expect(
      controller.submitGuidance(
        ids.organization,
        ids.project,
        ids.machine,
        ids.monitor,
        ids.command,
        ids.session,
        ids.conversation,
        guidanceInput,
        authenticatedMachine,
        request,
      ),
    ).rejects.toMatchObject({
      response: { code: 'TASK_MONITOR_MACHINE_MISMATCH' },
    });
    expect(
      executionGrantService.assertTaskMonitorMachineEffectAuthorized,
    ).not.toHaveBeenCalled();
    expect(messageController.postMessage).not.toHaveBeenCalled();
  });

  it('authors executable guidance fields from admitted server context', async () => {
    const { controller, messageController } = harness();

    await expect(
      controller.submitGuidance(
        ids.organization,
        ids.project,
        ids.machine,
        ids.monitor,
        ids.command,
        ids.session,
        ids.conversation,
        guidanceInput,
        authenticatedMachine,
        request,
      ),
    ).resolves.toMatchObject({ operationId: ids.effect, replayed: false });

    expect(messageController.postMessage).toHaveBeenCalledWith(
      ids.project,
      ids.organization,
      ids.user,
      expect.objectContaining({
        type: 'USER',
        userId: ids.user,
        projectId: ids.project,
        conversationId: ids.conversation,
        operationId: ids.effect,
        agentSessionId: ids.session,
        data: {
          agentInput: {
            promptType: 'coding_freeform',
            userMessage: guidanceInput.guidance,
            provenance: 'task_monitor',
          },
        },
      }),
      undefined,
      expect.any(Object),
    );

    const submittedMessage = messageController.postMessage.mock
      .calls[0][3] as SubmitExecutableUserMessageRequestDto;
    const {
      authorization: _authorization,
      operationId: _operationId,
      operationFingerprint,
      ...semanticMessage
    } = submittedMessage;
    expect(operationFingerprint).toBe(
      createHash('sha256')
        .update(
          canonicalizeJcs({
            kind: 'DIRECT_TRIGGER',
            organizationId: ids.organization,
            projectId: ids.project,
            message: semanticMessage,
          }),
          'utf8',
        )
        .digest('hex'),
    );
  });
});
