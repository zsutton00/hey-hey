import { MachineEffectHttpMethod } from '../../../generated';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  AgentSessionId,
  ConversationId,
  MachineId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../../types';
import type { MachineEffectAdmissionService } from '../../machine-effect-admission/machine-effect-admission.service';
import type { MessageService } from '../../message.service';
import type { FlowExecutionService } from '../../workflows/flow-execution.service';
import type { NodeExecutionService } from '../../workflows/node-execution.service';
import type { PendingTriggerService } from '../../workflows/pending-trigger.service';
import { ExternalAgentCompletionService } from '../external-agent-completion.service';

const ORGANIZATION_ID =
  '00000000-0000-4000-8000-000000000001' as OrganizationId;
const PROJECT_ID = '00000000-0000-4000-8000-000000000002' as ProjectId;
const MACHINE_ID = '00000000-0000-4000-8000-000000000003' as MachineId;
const USER_ID = '00000000-0000-4000-8000-000000000004' as UserId;
const SESSION_ID = '00000000-0000-4000-8000-000000000005' as AgentSessionId;
const CONVERSATION_ID =
  '00000000-0000-4000-8000-000000000006' as ConversationId;
const TRIGGER_ID = '00000000-0000-4000-8000-000000000007' as MessageId;

describe(ExternalAgentCompletionService.name, () => {
  const prisma = {
    db: {
      agentSession: { findFirst: jest.fn() },
      message: { findUnique: jest.fn() },
    },
  } as unknown as PrismaService;
  const machineEffectAdmission = {
    admit: jest.fn(),
  } as unknown as MachineEffectAdmissionService;
  const messageService = { addMessage: jest.fn() } as unknown as MessageService;
  const flowExecutionService = {
    findActiveByConversation: jest.fn(),
  } as unknown as FlowExecutionService;
  const pendingTriggerService = {
    resolvePendingTriggerForNode: jest.fn(),
  } as unknown as PendingTriggerService;
  const nodeExecutionService = {
    getNode: jest.fn(),
  } as unknown as NodeExecutionService;
  const service = new ExternalAgentCompletionService(
    prisma,
    machineEffectAdmission,
    messageService,
    flowExecutionService,
    pendingTriggerService,
    nodeExecutionService,
  );

  const input = () => ({
    conversationId: CONVERSATION_ID,
    workflowNodeId: 'implementation',
    pendingTriggerMessageId: TRIGGER_ID,
    action: 'DONE',
    payload: { response: 'Finished' },
    proof: {
      version: 1 as const,
      operationId: 'submitExternalAgentCompletion',
      method: MachineEffectHttpMethod.Post,
      path: `/api/v1/organizations/${ORGANIZATION_ID}/projects/${PROJECT_ID}/agent-sessions/${SESSION_ID}/external-agent-completions`,
      bodySha256: 'a'.repeat(64),
      organizationId: ORGANIZATION_ID,
      effectId: '00000000-0000-4000-8000-000000000008',
      nonce: '00000000-0000-4000-8000-000000000009',
      timestampMs: Date.now(),
      signature: 'a'.repeat(88),
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (machineEffectAdmission.admit as jest.Mock).mockResolvedValue({
      machineId: MACHINE_ID,
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      effectId: '00000000-0000-4000-8000-000000000008',
      operationId: 'submitExternalAgentCompletion',
    });
    (prisma.db.agentSession.findFirst as jest.Mock).mockResolvedValue({
      id: SESSION_ID,
    });
    (prisma.db.message.findUnique as jest.Mock).mockResolvedValue(null);
    (
      flowExecutionService.findActiveByConversation as jest.Mock
    ).mockResolvedValue({
      flowId: 'agent-session',
      currentNode: 'implementation',
    });
    (
      pendingTriggerService.resolvePendingTriggerForNode as jest.Mock
    ).mockResolvedValue({
      triggerMessageId: TRIGGER_ID,
    });
    (nodeExecutionService.getNode as jest.Mock).mockReturnValue({
      node: { type: 'external_agent', actions: { DONE: {} } },
    });
    (messageService.addMessage as jest.Mock).mockResolvedValue({});
  });

  const submit = () =>
    service.submit({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      agentSessionId: SESSION_ID,
      authenticatedMachine: { machineId: MACHINE_ID, userId: USER_ID },
      requestPath: input().proof.path,
      input: input(),
    });

  it('authors the executable completion only after every persisted binding matches', async () => {
    await expect(submit()).resolves.toEqual({
      completionMessageId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    });
    expect(prisma.db.agentSession.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: SESSION_ID,
        conversationId: CONVERSATION_ID,
        machineId: MACHINE_ID,
        userId: USER_ID,
      }),
      select: { id: true },
    });
    expect(messageService.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SYSTEM',
        data: expect.objectContaining({
          type: 'AGENT',
          completesExternalAgentNode: {
            nodeId: 'implementation',
            action: 'DONE',
            payload: { response: 'Finished' },
            completesTriggerMessageId: TRIGGER_ID,
          },
        }),
      }),
      ORGANIZATION_ID,
      'external-agent-completion',
    );
  });

  it('rejects a session not bound to the admitted machine before workflow lookup', async () => {
    (prisma.db.agentSession.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(submit()).rejects.toMatchObject({ status: 409 });
    expect(
      flowExecutionService.findActiveByConversation,
    ).not.toHaveBeenCalled();
    expect(messageService.addMessage).not.toHaveBeenCalled();
  });

  it('rejects a copied trigger identity before persistence', async () => {
    (
      pendingTriggerService.resolvePendingTriggerForNode as jest.Mock
    ).mockResolvedValue({
      triggerMessageId: '00000000-0000-4000-8000-000000000010',
    });
    await expect(submit()).rejects.toMatchObject({ status: 409 });
    expect(messageService.addMessage).not.toHaveBeenCalled();
  });

  it('rejects a request that violates the OpenAPI shape before machine admission', async () => {
    const malformed = { ...input(), response: 42 } as never;
    await expect(
      service.submit({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        agentSessionId: SESSION_ID,
        authenticatedMachine: { machineId: MACHINE_ID, userId: USER_ID },
        requestPath: input().proof.path,
        input: malformed,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(machineEffectAdmission.admit).not.toHaveBeenCalled();
    expect(messageService.addMessage).not.toHaveBeenCalled();
  });

  it('returns the exact recorded completion before re-resolving the consumed workflow boundary', async () => {
    const first = await submit();
    (prisma.db.message.findUnique as jest.Mock).mockResolvedValue({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
    });
    jest.clearAllMocks();
    (machineEffectAdmission.admit as jest.Mock).mockResolvedValue({
      machineId: MACHINE_ID,
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      effectId: '00000000-0000-4000-8000-000000000008',
      operationId: 'submitExternalAgentCompletion',
    });
    (prisma.db.agentSession.findFirst as jest.Mock).mockResolvedValue({
      id: SESSION_ID,
    });
    (prisma.db.message.findUnique as jest.Mock).mockResolvedValue({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
    });

    await expect(submit()).resolves.toEqual(first);
    expect(flowExecutionService.findActiveByConversation).not.toHaveBeenCalled();
    expect(pendingTriggerService.resolvePendingTriggerForNode).not.toHaveBeenCalled();
    expect(messageService.addMessage).not.toHaveBeenCalled();
  });
});
