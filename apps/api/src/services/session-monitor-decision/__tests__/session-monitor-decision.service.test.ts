import {
  AgentOperationKind,
  AgentOperationState,
  AgentSessionType,
  EntityType,
} from '@prisma/client';
import {
  MachineEffectHttpMethod,
  SessionMonitorDecisionAction,
  SessionMonitorDecisionDeferral,
  SessionMonitorDecisionResponse,
  SubmitSessionMonitorDecisionRequestDto,
} from '../../../generated';
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
import type { AgentOperationRegistryService } from '../../agent-operation/agent-operation-registry.service';
import type { MachineEffectAdmissionService } from '../../machine-effect-admission/machine-effect-admission.service';
import type { MessageService } from '../../message.service';
import type { FlowExecutionService } from '../../workflows/flow-execution.service';
import type { NodeExecutionService } from '../../workflows/node-execution.service';
import type { PendingTriggerService } from '../../workflows/pending-trigger.service';
import { SessionMonitorDecisionService } from '../session-monitor-decision.service';

const ORGANIZATION_ID =
  '00000000-0000-4000-8000-000000000001' as OrganizationId;
const PROJECT_ID = '00000000-0000-4000-8000-000000000002' as ProjectId;
const MACHINE_ID = '00000000-0000-4000-8000-000000000003' as MachineId;
const USER_ID = '00000000-0000-4000-8000-000000000004' as UserId;
const MONITOR_SESSION_ID =
  '00000000-0000-4000-8000-000000000005' as AgentSessionId;
const PARENT_SESSION_ID =
  '00000000-0000-4000-8000-000000000006' as AgentSessionId;
const CONVERSATION_ID =
  '00000000-0000-4000-8000-000000000007' as ConversationId;
const REPORT_ID = '00000000-0000-4000-8000-000000000008';
const DECISION_ID = '00000000-0000-4000-8000-000000000009';
const PENDING_TRIGGER_ID = '00000000-0000-4000-8000-000000000010' as MessageId;
const EVIDENCE_ID = '00000000-0000-4000-8000-000000000011' as MessageId;
const CONSEQUENCE_ID = '00000000-0000-4000-8000-000000000012' as MessageId;
const LAUNCH_SERVICE_ID = '00000000-0000-4000-8000-000000000016';
const SECOND_SERVICE_ID = '00000000-0000-4000-8000-000000000017';
const THIRD_SERVICE_ID = '00000000-0000-4000-8000-000000000018';

describe(SessionMonitorDecisionService.name, () => {
  const tx = {
    agentSession: { findUnique: jest.fn() },
  };
  const prisma = {
    db: {
      agentSession: { findFirst: jest.fn() },
      report: { findFirst: jest.fn() },
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    },
  } as unknown as PrismaService;
  const machineEffectAdmission = {
    admit: jest.fn(),
  } as unknown as MachineEffectAdmissionService;
  const operationRegistry = {
    begin: jest.fn(),
    reservedMessageIds: jest.fn(),
    succeedInTransaction: jest.fn(),
    fail: jest.fn(),
    waitForTerminal: jest.fn(),
  } as unknown as AgentOperationRegistryService;
  const messageService = {
    addMessageInTransaction: jest.fn(),
  } as unknown as MessageService;
  const flowExecutionService = {
    findActiveByConversation: jest.fn(),
  } as unknown as FlowExecutionService;
  const pendingTriggerService = {
    resolvePendingTriggerForNode: jest.fn(),
  } as unknown as PendingTriggerService;
  const nodeExecutionService = {
    getNode: jest.fn(),
  } as unknown as NodeExecutionService;
  const service = new SessionMonitorDecisionService(
    prisma,
    machineEffectAdmission,
    operationRegistry,
    messageService,
    flowExecutionService,
    pendingTriggerService,
    nodeExecutionService,
  );

  const input = (
    decision: SubmitSessionMonitorDecisionRequestDto['decision'] = {
      kind: SessionMonitorDecisionAction.KindEnum.Action,
      action: 'DONE',
      response: 'Finished',
    },
  ): SubmitSessionMonitorDecisionRequestDto => ({
    decisionId: DECISION_ID,
    parentAgentSessionId: PARENT_SESSION_ID,
    reportId: REPORT_ID,
    conversationId: CONVERSATION_ID,
    workflowNodeId: 'implementation',
    pendingTriggerMessageId: PENDING_TRIGGER_ID,
    content: 'Continuing after implementation.',
    decision,
    proof: {
      version: 1,
      operationId: 'submitSessionMonitorDecision',
      method: MachineEffectHttpMethod.Post,
      path: `/api/v1/organizations/${ORGANIZATION_ID}/projects/${PROJECT_ID}/agent-sessions/${MONITOR_SESSION_ID}/session-monitor-decisions`,
      bodySha256: 'a'.repeat(64),
      organizationId: ORGANIZATION_ID,
      effectId: '00000000-0000-4000-8000-000000000013',
      nonce: '00000000-0000-4000-8000-000000000014',
      timestampMs: Date.now(),
      signature: 'a'.repeat(86),
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    tx.agentSession.findUnique.mockResolvedValue({
      serviceId: LAUNCH_SERVICE_ID,
      serviceRelations: [
        { serviceId: LAUNCH_SERVICE_ID },
        { serviceId: SECOND_SERVICE_ID },
        { serviceId: THIRD_SERVICE_ID },
        { serviceId: SECOND_SERVICE_ID },
      ],
    });
    (machineEffectAdmission.admit as jest.Mock).mockResolvedValue({
      machineId: MACHINE_ID,
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      effectId: '00000000-0000-4000-8000-000000000013',
      operationId: 'submitSessionMonitorDecision',
    });
    (prisma.db.agentSession.findFirst as jest.Mock)
      .mockResolvedValueOnce({
        id: MONITOR_SESSION_ID,
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      })
      .mockResolvedValueOnce({
        id: PARENT_SESSION_ID,
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
        config: {
          type: 'CODING_SESSION',
          version: 'v2',
          sessionMonitorTerminalPolicy: {
            implementationDone: { completion: { action: 'DONE' } },
          },
        },
      });
    (prisma.db.report.findFirst as jest.Mock).mockResolvedValue({
      reportType: 'IMPLEMENT',
    });
    (operationRegistry.begin as jest.Mock).mockResolvedValue({
      disposition: 'EXECUTE',
      executionOwner: '00000000-0000-4000-8000-000000000015',
      operation: {
        operationId: DECISION_ID,
        kind: AgentOperationKind.SESSION_MONITOR_DECISION,
        state: AgentOperationState.SUBMITTING,
        result: {
          reservedMessageId: EVIDENCE_ID,
          reservedTriggerMessageId: CONSEQUENCE_ID,
        },
      },
    });
    (operationRegistry.reservedMessageIds as jest.Mock).mockReturnValue({
      messageId: EVIDENCE_ID,
      triggerMessageId: CONSEQUENCE_ID,
    });
    (
      flowExecutionService.findActiveByConversation as jest.Mock
    ).mockResolvedValue({
      flowId: 'agent-session',
      currentNode: 'implementation',
    });
    (
      pendingTriggerService.resolvePendingTriggerForNode as jest.Mock
    ).mockResolvedValue({ triggerMessageId: PENDING_TRIGGER_ID });
    (nodeExecutionService.getNode as jest.Mock).mockReturnValue({
      node: { type: 'external_agent', actions: { DONE: {} } },
    });
  });

  const submit = (request = input()) =>
    service.submit({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      monitorSessionId: MONITOR_SESSION_ID,
      authenticatedMachine: { machineId: MACHINE_ID, userId: USER_ID },
      requestPath: request.proof.path,
      input: request,
    });

  it('admits an exact action, persists consequence before evidence, and records one durable result', async () => {
    await expect(submit()).resolves.toEqual({
      decisionId: DECISION_ID,
      decisionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      evidenceMessageId: EVIDENCE_ID,
      consequenceMessageId: CONSEQUENCE_ID,
      replayed: false,
    });

    expect(machineEffectAdmission.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'submitSessionMonitorDecision',
        payload: expect.not.objectContaining({ proof: expect.anything() }),
      }),
    );
    expect(prisma.db.agentSession.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: MONITOR_SESSION_ID,
          machineId: MACHINE_ID,
          type: AgentSessionType.SESSION_MONITOR,
          entityType: EntityType.AGENT_SESSION,
          entityId: PARENT_SESSION_ID,
        }),
      }),
    );
    expect(messageService.addMessageInTransaction).toHaveBeenCalledTimes(2);
    const consequence = (messageService.addMessageInTransaction as jest.Mock)
      .mock.calls[0]?.[1];
    const evidence = (messageService.addMessageInTransaction as jest.Mock).mock
      .calls[1]?.[1];
    expect(consequence).toMatchObject({
      id: CONSEQUENCE_ID,
      type: 'SYSTEM',
      data: {
        type: 'AGENT',
        completesExternalAgentNode: {
          nodeId: 'implementation',
          action: 'DONE',
          completesTriggerMessageId: PENDING_TRIGGER_ID,
        },
      },
    });
    expect(evidence).toMatchObject({
      id: EVIDENCE_ID,
      type: 'SYSTEM',
      parentMessageId: CONSEQUENCE_ID,
      data: {
        type: 'SESSION_MONITOR',
        decisionOperationId: DECISION_ID,
        consequenceMessageId: CONSEQUENCE_ID,
      },
    });
    expect(operationRegistry.succeedInTransaction).toHaveBeenCalledTimes(1);
  });

  it('creates the executable USER continuation only inside the admitted response arm', async () => {
    const request = input({
      kind: SessionMonitorDecisionResponse.KindEnum.Response,
      response: 'Continue with the review.',
    });
    await submit(request);
    const consequence = (messageService.addMessageInTransaction as jest.Mock)
      .mock.calls[0]?.[1];
    expect(consequence).toMatchObject({
      id: CONSEQUENCE_ID,
      type: 'USER',
      userId: USER_ID,
      data: {
        agentInput: { provenance: 'session_monitor' },
        triggersAgent: {
          operationId: DECISION_ID,
          operationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          triggerMessageId: CONSEQUENCE_ID,
          sourceUserMessageId: CONSEQUENCE_ID,
        },
      },
    });
    expect(consequence.data.triggersAgent).not.toHaveProperty(
      'admittedServiceScope',
    );
  });

  it('records a deferral without requiring or resolving an active workflow boundary', async () => {
    const request = input({
      kind: SessionMonitorDecisionDeferral.KindEnum.Defer,
    });
    delete request.workflowNodeId;
    delete request.pendingTriggerMessageId;

    await expect(submit(request)).resolves.toEqual({
      decisionId: DECISION_ID,
      decisionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      evidenceMessageId: EVIDENCE_ID,
      consequenceMessageId: null,
      replayed: false,
    });

    expect(
      flowExecutionService.findActiveByConversation,
    ).not.toHaveBeenCalled();
    expect(
      pendingTriggerService.resolvePendingTriggerForNode,
    ).not.toHaveBeenCalled();
    expect(messageService.addMessageInTransaction).toHaveBeenCalledTimes(1);
    expect(
      (messageService.addMessageInTransaction as jest.Mock).mock.calls[0]?.[1],
    ).toMatchObject({
      id: EVIDENCE_ID,
      type: 'SYSTEM',
      parentMessageId: null,
      data: {
        type: 'SESSION_MONITOR',
        outcome: 'DEFERRED',
        consequenceMessageId: null,
      },
    });
  });

  it('rejects a stale node before message creation', async () => {
    (
      flowExecutionService.findActiveByConversation as jest.Mock
    ).mockResolvedValue({
      flowId: 'agent-session',
      currentNode: 'review',
    });
    await expect(submit()).rejects.toMatchObject({ status: 409 });
    expect(messageService.addMessageInTransaction).not.toHaveBeenCalled();
    expect(operationRegistry.fail).toHaveBeenCalled();
  });

  it('rejects a monitor session not bound to the authenticated machine before claiming the decision', async () => {
    (prisma.db.agentSession.findFirst as jest.Mock).mockReset();
    (prisma.db.agentSession.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(submit()).rejects.toMatchObject({ status: 409 });
    expect(operationRegistry.begin).not.toHaveBeenCalled();
    expect(messageService.addMessageInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a malformed decision at the OpenAPI boundary before machine admission', async () => {
    const request = { ...input(), decision: null } as never;
    await expect(submit(request)).rejects.toMatchObject({ status: 400 });
    expect(machineEffectAdmission.admit).not.toHaveBeenCalled();
    expect(operationRegistry.begin).not.toHaveBeenCalled();
  });

  it('returns a same-fingerprint durable result without re-enacting after fresh machine admission', async () => {
    (operationRegistry.begin as jest.Mock).mockResolvedValue({
      disposition: 'RETURN',
      executionOwner: 'unused',
      operation: {
        operationId: DECISION_ID,
        kind: AgentOperationKind.SESSION_MONITOR_DECISION,
        state: AgentOperationState.SUCCEEDED,
        result: {
          decisionId: DECISION_ID,
          decisionFingerprint: 'b'.repeat(64),
          evidenceMessageId: EVIDENCE_ID,
          consequenceMessageId: CONSEQUENCE_ID,
        },
      },
    });
    await expect(submit()).resolves.toEqual({
      decisionId: DECISION_ID,
      decisionFingerprint: 'b'.repeat(64),
      evidenceMessageId: EVIDENCE_ID,
      consequenceMessageId: CONSEQUENCE_ID,
      replayed: true,
    });
    expect(
      flowExecutionService.findActiveByConversation,
    ).not.toHaveBeenCalled();
    expect(messageService.addMessageInTransaction).not.toHaveBeenCalled();
  });
});
