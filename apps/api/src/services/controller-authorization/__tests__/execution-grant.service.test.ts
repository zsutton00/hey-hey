import { hashControllerAction } from '../../../generated/controller-action-contract';
import {
  ControllerAuthorizationCadence as PrismaControllerAuthorizationCadence,
  ExecutionGrantScope as PrismaExecutionGrantScope,
  HostActionTargetKind as PrismaHostActionTargetKind,
  HostAffectingActionType as PrismaHostAffectingActionType,
} from '@prisma/client';
import * as crypto from 'node:crypto';
import {
  ControllerAssertionEvidence,
  HostActionCategory,
  HostActionPreparation,
  HostActionTargetKind,
  HostAffectingActionType,
} from '../../../generated';
import { canonicalizeJcs } from '../../../core/websockets/trigger-canonicalization';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  MachineId,
  MessageId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../../../types';
import { PRISMA_CURRENT_AGENT_OPERATIONS } from '../controller-authorization.service';
import {
  ExecutionGrantAdmissionDeniedException,
  ExecutionGrantService,
} from '../execution-grant.service';

const ids = {
  authorization: '10000000-0000-4000-8000-000000000001',
  request: '20000000-0000-4000-8000-000000000002',
  controller: '30000000-0000-4000-8000-000000000003',
  installation: '3a000000-0000-4000-8000-000000000003',
  bindingSecret: 'opaque-controller-binding',
  machine: '40000000-0000-4000-8000-000000000004' as MachineId,
  user: '50000000-0000-4000-8000-000000000005' as UserId,
  organization: '60000000-0000-4000-8000-000000000006' as OrganizationId,
  project: '70000000-0000-4000-8000-000000000007' as ProjectId,
  conversation: '80000000-0000-4000-8000-000000000008',
  session: '90000000-0000-4000-8000-000000000009',
  turn: 'a0000000-0000-4000-8000-00000000000a' as MessageId,
  monitor: 'b0000000-0000-4000-8000-00000000000b' as TaskId,
};

const sha256 = (value: string): string =>
  crypto.createHash('sha256').update(value, 'utf8').digest('hex');

const freshAuthorization = {
  kind: 'controller_assertion',
  intent: { authorizationId: ids.authorization },
  credentialId: ids.controller,
  clientDataJSON: 'client-data',
  authenticatorData: 'authenticator-data',
  signature: 'signature',
  userHandle: null,
  grantDescriptor: {},
} as unknown as ControllerAssertionEvidence;

const interactiveAction = (): HostActionPreparation => ({
  requestId: ids.request,
  actionCategory: HostActionCategory.Conversation,
  actionType: HostAffectingActionType.ConversationTrigger,
  targetKind: 'CONVERSATION',
  targetId: ids.conversation,
});

const authorization = (
  action: HostActionPreparation,
  overrides: Record<string, unknown> = {},
) => ({
  id: ids.authorization,
  requestId: ids.request,
  canonicalIntent: '{}',
  webauthnChallenge: 'challenge',
  controllerCredentialId: ids.controller,
  controllerInstallationId: ids.installation,
  machineId: ids.machine,
  userId: ids.user,
  organizationId: ids.organization,
  projectId: ids.project,
  cadence: PrismaControllerAuthorizationCadence.FIVE_MINUTES,
  policyRevision: 1,
  grantDescriptorHash: 'b'.repeat(64),
  actionCategory: action.actionCategory,
  actionType: action.actionType,
  actionPayloadHash: hashControllerAction(action),
  targetKind: action.targetKind,
  targetId: action.targetId,
  agentSessionId: null,
  taskMonitorId: action.targetKind === 'TASK_MONITOR' ? action.targetId : null,
  nonce: 'nonce',
  issuedAt: new Date(Date.now() - 1_000),
  expiresAt: new Date(Date.now() + 60_000),
  consumedAt: new Date(),
  outcome: 'ADMITTED',
  outcomeReason: null,
  outcomeRecordedAt: new Date(),
  createdAt: new Date(),
  grant: null,
  assertionEvidence: freshAuthorization,
  controllerCredential: { credentialId: ids.controller, revokedAt: null },
  machine: {
    revokedAt: null,
    authorizationProtocolVersion: 2,
    authorizationState: 'READY',
  },
  ...overrides,
});

const harness = () => {
  const db: Record<string, any> = {
    executionAuthorization: { findUnique: jest.fn() },
    executionGrant: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    agentSession: { findFirst: jest.fn() },
    task: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
  };
  db.$transaction = jest.fn(async (callback: (tx: typeof db) => unknown) =>
    callback(db),
  );
  const browserBindingService = {
    resolveForAdmission: jest.fn().mockResolvedValue({
      controllerInstallationId: ids.installation,
      controllerCredentialId: ids.controller,
      userId: ids.user,
      organizationId: ids.organization,
      expiresAt: new Date(Date.now() + 60_000),
    }),
  };
  return {
    db,
    browserBindingService,
    service: new ExecutionGrantService(
      { db } as unknown as PrismaService,
      browserBindingService as never,
      {
        resolveDirectInputs: jest
          .fn()
          .mockImplementation(async ({ action }) => action),
      } as never,
    ),
  };
};

describe('ExecutionGrantService', () => {
  it('denies missing interactive authorization before reading grant state', async () => {
    const { db, service } = harness();

    await expect(
      service.assertInteractiveAuthorized({
        authorization: undefined as never,
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        controllerBindingSecret: ids.bindingSecret,
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: 'CONVERSATION',
        targetId: ids.conversation,
      }),
    ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);

    expect(db.executionAuthorization.findUnique).not.toHaveBeenCalled();
    expect(db.executionGrant.findUnique).not.toHaveBeenCalled();
    expect(db.agentSession.findFirst).not.toHaveBeenCalled();
  });

  it('denies bounded-grant reuse without an authenticated browser-session binding', async () => {
    const { db, service } = harness();
    const issuedAt = new Date(Date.now() - 1_000);
    const grant = {
      id: 'grant-id',
      scope: PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
      controllerInstallationId: ids.installation,
      expiresAt: new Date(Date.now() + 60_000),
      suspendedAt: null,
      terminalAt: null,
      revokedAt: null,
    };
    db.executionGrant.findUnique.mockResolvedValue({
      authorizationId: ids.authorization,
    });
    db.executionAuthorization.findUnique.mockResolvedValue(
      authorization(interactiveAction(), {
        issuedAt,
        grant,
      }),
    );

    await expect(
      service.assertInteractiveAuthorized({
        authorization: { kind: 'bounded_grant', grantId: 'grant-id' },
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        controllerBindingSecret: undefined,
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: 'CONVERSATION',
        targetId: ids.conversation,
      }),
    ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);

    expect(db.agentSession.findFirst).not.toHaveBeenCalled();
  });

  it('denies a browser binding that substitutes another controller installation', async () => {
    const { db, service, browserBindingService } = harness();
    browserBindingService.resolveForAdmission.mockResolvedValue({
      controllerInstallationId: '3c000000-0000-4000-8000-000000000003',
      controllerCredentialId: ids.controller,
      controllerCredentialPublicId: 'credential-public-id',
      machineId: ids.machine,
      userId: ids.user,
      organizationId: ids.organization,
      expiresAt: new Date(Date.now() + 60_000),
    });
    db.executionAuthorization.findUnique.mockResolvedValue(
      authorization(interactiveAction()),
    );

    await expect(
      service.assertInteractiveAuthorized({
        authorization: freshAuthorization,
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        controllerBindingSecret: ids.bindingSecret,
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: 'CONVERSATION',
        targetId: ids.conversation,
      }),
    ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);

    expect(db.agentSession.findFirst).not.toHaveBeenCalled();
    expect(db.executionGrant.create).not.toHaveBeenCalled();
  });

  it('accepts fresh exact proof only with the resolved browser binding', async () => {
    const { db, service } = harness();
    db.executionAuthorization.findUnique.mockResolvedValue(
      authorization(interactiveAction()),
    );
    db.agentSession.findFirst.mockResolvedValue({ id: ids.session });

    await expect(
      service.assertInteractiveAuthorized({
        authorization: freshAuthorization,
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        controllerBindingSecret: ids.bindingSecret,
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: 'CONVERSATION',
        targetId: ids.conversation,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        controllerInstallationId: ids.installation,
      }),
    );
  });

  it('accepts matching read inputs and rejects changed inputs with the same fresh evidence before grant creation', async () => {
    const { db, service } = harness();
    const inputs = {
      kind: 'CLI_READ' as const,
      body: {
        requestId: ids.request,
        agentSessionId: ids.session,
        operation: 'run.changed_files.detail' as const,
        runId: ids.session,
        file: {
          serviceId: ids.monitor,
          repoPath: '/workspace',
          filePath: 'approved.ts',
        },
      },
    };
    const action: HostActionPreparation = {
      requestId: ids.request,
      actionCategory: HostActionCategory.CliRead,
      actionType: HostAffectingActionType.CliRead,
      targetKind: 'AGENT_SESSION',
      targetId: ids.session,
      inputs,
    };
    db.executionAuthorization.findUnique.mockResolvedValue(
      authorization(action),
    );
    db.executionGrant.create.mockImplementation(async ({ data }: any) => ({
      id: 'grant-id',
      ...data,
    }));
    const params = {
      authorization: freshAuthorization,
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      controllerBindingSecret: ids.bindingSecret,
      machineId: ids.machine,
      actionCategory: HostActionCategory.CliRead,
      actionType: HostAffectingActionType.CliRead,
      targetKind: 'AGENT_SESSION' as const,
      agentSessionId: ids.session as never,
      conversationId: ids.conversation,
    };
    await expect(
      service.assertAgentSessionAuthorized({ ...params, inputs }),
    ).resolves.toMatchObject({ action });
    db.executionGrant.create.mockClear();
    await expect(
      service.assertAgentSessionAuthorized({
        ...params,
        inputs: {
          ...inputs,
          body: {
            ...inputs.body,
            file: { ...inputs.body.file, filePath: 'changed.ts' },
          },
        },
      }),
    ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);
    expect(db.executionGrant.create).not.toHaveBeenCalled();
  });

  it.each(['Please start', ''])(
    'accepts startup %j and rejects altered task context under the same exact-action approval',
    async (userMessage) => {
      const { db, service } = harness();
      const inputs = {
        kind: 'START_RUN' as const,
        payload: {
          agentSessionId: ids.session,
          workflowName: 'feature-sync' as const,
          model: 'gpt-5',
          provider: 'codex' as const,
          payload: { promptType: 'workflow_kickoff' as const, userMessage },
          contextMetadata: {
            capturedAt: new Date().toISOString(),
            organizationId: ids.organization,
            projectId: ids.project,
            agentSessionId: ids.session,
            userComments: [],
            fileReferences: { resolved: [], unresolved: [] },
            task: {
              id: ids.monitor,
              name: 'Repair startup',
              type: 'BUG',
              status: 'BACKLOG' as const,
              source: 'user' as const,
              organizationId: ids.organization,
              projectId: ids.project,
              initiativeId: null,
              parentTaskId: null,
              archivedAt: null,
              designDocCount: null,
              codingSessionCount: null,
              agentSessionCount: null,
              sections: [
                {
                  id: ids.monitor,
                  key: 'description',
                  order: 0,
                  materializedMarkdown: 'Retain context',
                  materializedProposalId: '',
                },
              ],
            },
          },
        },
      };
      const action: HostActionPreparation = {
        requestId: ids.request,
        actionCategory: HostActionCategory.Conversation,
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: 'AGENT_SESSION',
        targetId: ids.session,
        inputs,
      };
      db.executionAuthorization.findUnique.mockResolvedValue(
        authorization(action),
      );
      db.executionGrant.create.mockImplementation(async ({ data }: any) => ({
        id: 'grant-id',
        ...data,
      }));
      const params = {
        authorization: freshAuthorization,
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        controllerBindingSecret: ids.bindingSecret,
        machineId: ids.machine,
        actionCategory: HostActionCategory.Conversation,
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: 'AGENT_SESSION' as const,
        agentSessionId: ids.session as never,
        conversationId: ids.conversation,
      };
      await expect(
        service.assertAgentSessionAuthorized({ ...params, inputs }),
      ).resolves.toMatchObject({ action });
      db.executionGrant.create.mockClear();
      const altered = structuredClone(inputs);
      altered.payload.contextMetadata.task.name = 'Changed after approval';
      await expect(
        service.assertAgentSessionAuthorized({ ...params, inputs: altered }),
      ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);
      expect(db.executionGrant.create).not.toHaveBeenCalled();
    },
  );

  it('constructs reusable Agent Session activation only after the server grant exists', async () => {
    const { db, service } = harness();
    const action: HostActionPreparation = {
      requestId: ids.request,
      actionCategory: HostActionCategory.CliRead,
      actionType: HostAffectingActionType.CliRead,
      targetKind: 'AGENT_SESSION',
      targetId: ids.session,
    };
    const prepared = authorization(action, {
      cadence: PrismaControllerAuthorizationCadence.ONE_DAY,
    });
    db.executionAuthorization.findUnique.mockResolvedValue(prepared);
    db.executionGrant.create.mockImplementation(async ({ data }: any) => ({
      id: 'grant-id',
      ...data,
    }));

    await expect(
      service.assertAgentSessionAuthorized({
        authorization: freshAuthorization,
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        controllerBindingSecret: ids.bindingSecret,
        machineId: ids.machine,
        actionCategory: HostActionCategory.CliRead,
        actionType: HostAffectingActionType.CliRead,
        targetKind: HostActionTargetKind.AgentSession,
        agentSessionId: ids.session as never,
        conversationId: ids.conversation,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        envelopeAuthorization: {
          ...freshAuthorization,
          grantId: 'grant-id',
        },
      }),
    );
    expect(db.executionGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
        targetKind: PrismaHostActionTargetKind.AGENT_SESSION,
        targetId: ids.session,
        agentSessionId: null,
        authorizedTurnId: null,
        allowedActions: expect.arrayContaining([
          PrismaHostAffectingActionType.CLI_READ,
          PrismaHostAffectingActionType.CONVERSATION_CONTROL_COMPACT_RUN,
        ]),
      }),
    });
  });

  it.each([
    ['expired', { grant: { expiresAt: new Date(Date.now() - 1) } }, {}],
    ['revoked', { grant: { revokedAt: new Date() } }, {}],
    ['suspended', { grant: { suspendedAt: new Date() } }, {}],
    [
      'cross-organization',
      {},
      {
        organizationId:
          'd0000000-0000-4000-8000-00000000000d' as OrganizationId,
      },
    ],
    [
      'cross-user',
      {},
      { userId: 'f0000000-0000-4000-8000-00000000000f' as UserId },
    ],
    [
      'cross-installation',
      { grant: { controllerInstallationId: 'substituted-installation' } },
      {},
    ],
    [
      'cross-machine',
      {},
      {
        machineId: 'e0000000-0000-4000-8000-00000000000e' as MachineId,
      },
    ],
    ['stale-policy', { grant: { policyRevision: 0 } }, {}],
    ['action-widening', { grant: { allowedActions: [] } }, {}],
  ] as const)(
    'denies an active-grant %s mismatch before resolving domain scope',
    async (_label, overrides, contextOverrides) => {
      const { db, service } = harness();
      const issuedAt = new Date(Date.now() - 1_000);
      const expiresAt = new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000);
      const baseGrant = {
        id: 'grant-id',
        authorizationId: ids.authorization,
        scope: PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
        controllerCredentialId: ids.controller,
        controllerInstallationId: ids.installation,
        machineId: ids.machine,
        userId: ids.user,
        organizationId: ids.organization,
        projectId: ids.project,
        cadence: PrismaControllerAuthorizationCadence.ONE_DAY,
        policyRevision: 1,
        grantDescriptorHash: 'b'.repeat(64),
        targetKind: PrismaHostActionTargetKind.AGENT_SESSION,
        targetId: ids.session,
        allowedActions: [PrismaHostAffectingActionType.CLI_READ],
        agentSessionId: null,
        authorizedTurnId: null,
        taskMonitorId: null,
        selectedWorkFingerprint: null,
        policyFingerprint: null,
        issuedAt,
        expiresAt,
        suspendedAt: null,
        terminalAt: null,
        revokedAt: null,
        createdAt: issuedAt,
        ...(('grant' in overrides ? overrides.grant : undefined) ?? {}),
      };
      db.executionGrant.findUnique.mockResolvedValue({
        authorizationId: ids.authorization,
      });
      db.executionAuthorization.findUnique.mockResolvedValue(
        authorization(interactiveAction(), {
          cadence: PrismaControllerAuthorizationCadence.ONE_DAY,
          issuedAt,
          expiresAt,
          grant: baseGrant,
        }),
      );

      await expect(
        service.assertAgentSessionAuthorized({
          authorization: { kind: 'bounded_grant', grantId: 'grant-id' },
          organizationId: ids.organization,
          projectId: ids.project,
          userId: ids.user,
          controllerBindingSecret: ids.bindingSecret,
          machineId: ids.machine,
          actionCategory: HostActionCategory.CliRead,
          actionType: HostAffectingActionType.CliRead,
          targetKind: HostActionTargetKind.AgentSession,
          agentSessionId: ids.session as never,
          conversationId: ids.conversation,
          ...contextOverrides,
        }),
      ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);
      await expect(
        service.assertWorkspaceSkillsAuthorized({
          authorization: { kind: 'bounded_grant', grantId: 'grant-id' },
          request: {
            operation: 'workspace.skills.list',
            provider: 'codex',
            catalogContext: { policy: 'non_repository' },
            authorization: { kind: 'bounded_grant', grantId: 'grant-id' },
          },
          organizationId: ids.organization,
          projectId: ids.project,
          userId: ids.user,
          machineId: ids.machine,
          controllerBindingSecret: ids.bindingSecret,
          ...contextOverrides,
        }),
      ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);
      expect(db.agentSession.findFirst).not.toHaveBeenCalled();
      expect(db.executionGrant.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing', null, null],
    ['substituted', { authorizationId: ids.authorization }, 'other-grant'],
  ] as const)(
    'denies a %s grant reference before domain access',
    async (_label, reference, persistedGrantId) => {
      const { db, service } = harness();
      db.executionGrant.findUnique.mockResolvedValue(reference);
      if (reference) {
        db.executionAuthorization.findUnique.mockResolvedValue(
          authorization(interactiveAction(), {
            grant: { id: persistedGrantId },
          }),
        );
      }
      await expect(
        service.assertInteractiveAuthorized({
          authorization: { kind: 'bounded_grant', grantId: 'grant-id' },
          organizationId: ids.organization,
          projectId: ids.project,
          userId: ids.user,
          controllerBindingSecret: ids.bindingSecret,
          actionType: HostAffectingActionType.ConversationTrigger,
          targetKind: 'CONVERSATION',
          targetId: ids.conversation,
        }),
      ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);
      expect(db.agentSession.findFirst).not.toHaveBeenCalled();
    },
  );

  it('denies substituted interactive scope before resolving a session or creating a grant', async () => {
    const { db, service } = harness();
    db.executionAuthorization.findUnique.mockResolvedValue(
      authorization(interactiveAction(), {
        targetId: 'different-conversation',
      }),
    );

    await expect(
      service.assertInteractiveAuthorized({
        authorization: freshAuthorization,
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        controllerBindingSecret: ids.bindingSecret,
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: 'CONVERSATION',
        targetId: ids.conversation,
      }),
    ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);

    expect(db.agentSession.findFirst).not.toHaveBeenCalled();
    expect(db.executionGrant.create).not.toHaveBeenCalled();
  });

  it('persists a five-minute controller-device window for interactive work', async () => {
    const { db, service } = harness();
    const prepared = authorization(interactiveAction());
    db.executionAuthorization.findUnique.mockResolvedValue(prepared);
    db.agentSession.findFirst.mockResolvedValue({ id: ids.session });
    db.executionGrant.create.mockImplementation(async ({ data }: any) => ({
      id: 'grant-id',
      ...data,
    }));

    const admission = await service.assertInteractiveAuthorized({
      authorization: freshAuthorization,
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      controllerBindingSecret: ids.bindingSecret,
      actionType: HostAffectingActionType.ConversationTrigger,
      targetKind: 'CONVERSATION',
      targetId: ids.conversation,
    });
    const derived = await service.deriveInteractiveGrant({
      admission,
      authorizedTurnId: ids.turn,
    });

    expect(derived.envelopeAuthorization).toEqual({
      ...freshAuthorization,
      grantId: 'grant-id',
    });

    expect(db.executionGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
        targetKind: PrismaHostActionTargetKind.CONVERSATION,
        targetId: ids.conversation,
        agentSessionId: null,
        authorizedTurnId: null,
        expiresAt: new Date(prepared.issuedAt.getTime() + 5 * 60 * 1000),
      }),
    });
  });

  it('derives exactly one controller-device window from a non-every-action cadence', async () => {
    const { db, service } = harness();
    const prepared = authorization(interactiveAction(), {
      cadence: PrismaControllerAuthorizationCadence.ONE_DAY,
    });
    db.executionAuthorization.findUnique.mockResolvedValue(prepared);
    db.agentSession.findFirst.mockResolvedValue({ id: ids.session });
    db.executionGrant.create.mockImplementation(async ({ data }: any) => ({
      id: 'grant-id',
      ...data,
    }));

    const admission = await service.assertInteractiveAuthorized({
      authorization: freshAuthorization,
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      controllerBindingSecret: ids.bindingSecret,
      actionType: HostAffectingActionType.ConversationTrigger,
      targetKind: 'CONVERSATION',
      targetId: ids.conversation,
      controllerInstallationId: ids.installation,
    });
    const derived = await service.deriveInteractiveGrant({
      admission,
      authorizedTurnId: ids.turn,
    });

    expect(derived.envelopeAuthorization).toEqual({
      ...freshAuthorization,
      grantId: 'grant-id',
    });

    expect(db.executionGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scope: PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
        controllerInstallationId: ids.installation,
        targetKind: PrismaHostActionTargetKind.CONVERSATION,
        targetId: ids.conversation,
        agentSessionId: null,
        authorizedTurnId: null,
        issuedAt: prepared.issuedAt,
        expiresAt: new Date(prepared.issuedAt.getTime() + 24 * 60 * 60 * 1000),
      }),
    });
  });

  it('rejects a removed every-action authorization before grant reuse', async () => {
    const { db, service } = harness();
    const grant = {
      id: 'grant-id',
      authorizationId: ids.authorization,
      scope: PrismaExecutionGrantScope.INTERACTIVE_TURN,
      controllerCredentialId: ids.controller,
      controllerInstallationId: ids.installation,
      machineId: ids.machine,
      userId: ids.user,
      organizationId: ids.organization,
      projectId: ids.project,
      cadence: PrismaControllerAuthorizationCadence.EVERY_ACTION,
      policyRevision: 1,
      grantDescriptorHash: 'b'.repeat(64),
      targetKind: PrismaHostActionTargetKind.AGENT_SESSION,
      targetId: ids.session,
      allowedActions: [
        PrismaHostAffectingActionType.CONVERSATION_TRIGGER,
        PrismaHostAffectingActionType.CLI_READ,
        PrismaHostAffectingActionType.APPLICATION_EFFECT_LAUNCH,
        PrismaHostAffectingActionType.CONVERSATION_CONTROL_COMPACT_RUN,
        PrismaHostAffectingActionType.CONVERSATION_CONTROL_PERMISSION_DECISION,
      ],
      agentSessionId: ids.session,
      authorizedTurnId: ids.turn,
      taskMonitorId: null,
      selectedWorkFingerprint: null,
      policyFingerprint: null,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      suspendedAt: null,
      terminalAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    db.executionAuthorization.findUnique.mockResolvedValue(
      authorization(interactiveAction(), {
        cadence: PrismaControllerAuthorizationCadence.EVERY_ACTION,
        grant,
      }),
    );
    await expect(
      service.assertInteractiveAuthorized({
        authorization: freshAuthorization,
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        controllerBindingSecret: ids.bindingSecret,
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: 'CONVERSATION',
        targetId: ids.conversation,
      }),
    ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);
    expect(db.executionGrant.create).not.toHaveBeenCalled();
  });

  it('derives a Task Monitor grant from current selection, policy, revision, and exact action', async () => {
    const { db, service } = harness();
    const updatedAt = new Date('2026-08-13T12:00:00.000Z');
    const command = {
      cause: 'START',
      launchConfig: {
        taskId: 'd0000000-0000-4000-8000-00000000000d',
        method: 'quick',
        provider: 'codex',
        model: 'gpt-5.6',
        reasoningEffort: 'high',
      },
    } as const;
    const action: HostActionPreparation = {
      requestId: ids.request,
      actionCategory: HostActionCategory.TaskMonitor,
      actionType: HostAffectingActionType.TaskMonitorStart,
      targetKind: 'TASK_MONITOR',
      targetId: ids.monitor,
      inputs: { kind: 'TASK_MONITOR', command },
    };
    db.executionAuthorization.findUnique.mockResolvedValue(
      authorization(action, {
        cadence: PrismaControllerAuthorizationCadence.ONE_DAY,
      }),
    );
    db.task.findFirst.mockResolvedValue({
      updatedAt,
      sections: [
        {
          materializedMarkdown: JSON.stringify({
            executionPlan: [
              {
                taskId: 'd0000000-0000-4000-8000-00000000000d',
                dependsOnTaskIds: [],
                launchConfiguration: { provider: 'codex', model: 'gpt-5.6' },
              },
            ],
            launchPolicy: { terminalSupervision: { mode: 'REQUIRE_REVIEW' } },
          }),
        },
      ],
    });
    db.executionGrant.create.mockImplementation(async ({ data }: any) => ({
      id: 'grant-id',
      ...data,
    }));

    const result = await service.admitTaskMonitorCommand({
      authorization: freshAuthorization,
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      controllerBindingSecret: ids.bindingSecret,
      monitorId: ids.monitor,
      machineId: ids.machine,
      requestId: ids.request,
      command,
    });

    expect(result.machineId).toBe(ids.machine);
    expect(result.envelopeAuthorization).toEqual({
      ...freshAuthorization,
      grantId: 'grant-id',
    });
    expect(db.executionGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authorizationId: ids.authorization,
        machineId: ids.machine,
        scope: PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
        taskMonitorId: null,
        allowedActions: [...PRISMA_CURRENT_AGENT_OPERATIONS],
        selectedWorkFingerprint: null,
        policyFingerprint: null,
      }),
    });
  });

  it('keeps pause, stop, and halt independently available as reductions', async () => {
    const { db, service } = harness();
    db.executionGrant.updateMany.mockResolvedValue({ count: 1 });

    await service.reduceTaskMonitorAuthority({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      monitorId: ids.monitor,
      command: { cause: 'PAUSE' },
    });

    expect(db.executionGrant.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        taskMonitorId: ids.monitor,
        suspendedAt: null,
      }),
      data: { suspendedAt: expect.any(Date) },
    });
  });
});

describe('workspace Skill grant reuse', () => {
  it('uses an existing controller window without allocating a session or another grant', async () => {
    const { db, service } = harness();
    const issuedAt = new Date(Date.now() - 1000);
    const expiresAt = new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000);
    const grant = {
      id: 'grant-id',
      authorizationId: ids.authorization,
      scope: PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
      controllerCredentialId: ids.controller,
      controllerInstallationId: ids.installation,
      machineId: ids.machine,
      userId: ids.user,
      organizationId: ids.organization,
      projectId: ids.project,
      cadence: PrismaControllerAuthorizationCadence.ONE_DAY,
      policyRevision: 1,
      grantDescriptorHash: 'b'.repeat(64),
      targetKind: PrismaHostActionTargetKind.AGENT_SESSION,
      targetId: ids.session,
      allowedActions: [...PRISMA_CURRENT_AGENT_OPERATIONS],
      agentSessionId: null,
      authorizedTurnId: null,
      taskMonitorId: null,
      selectedWorkFingerprint: null,
      policyFingerprint: null,
      issuedAt,
      expiresAt,
      suspendedAt: null,
      terminalAt: null,
      revokedAt: null,
      createdAt: issuedAt,
    };
    db.executionGrant.findUnique.mockResolvedValue({
      authorizationId: ids.authorization,
    });
    db.executionAuthorization.findUnique.mockResolvedValue(
      authorization(interactiveAction(), {
        cadence: PrismaControllerAuthorizationCadence.ONE_DAY,
        issuedAt,
        expiresAt,
        grant,
      }),
    );
    const admission = await service.assertWorkspaceSkillsAuthorized({
      authorization: { kind: 'bounded_grant', grantId: 'grant-id' },
      request: {
        operation: 'workspace.skills.list',
        provider: 'codex',
        catalogContext: { policy: 'non_repository' },
        authorization: { kind: 'bounded_grant', grantId: 'grant-id' },
      },
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      machineId: ids.machine,
      controllerBindingSecret: ids.bindingSecret,
    });
    expect(admission.envelopeAuthorization).toEqual({
      kind: 'bounded_grant',
      grantId: 'grant-id',
    });
    expect(admission.action).toMatchObject({
      actionType: 'CLI_READ',
      targetKind: 'CLI_READ',
      targetId: ids.machine,
      catalogContext: { policy: 'non_repository' },
    });
    expect(db.executionGrant.create).not.toHaveBeenCalled();
    expect(db.agentSession.findFirst).not.toHaveBeenCalled();
  });
});

describe('model catalog grant reuse', () => {
  it('uses an existing controller window without allocating a session or another grant', async () => {
    const { db, service } = harness();
    const issuedAt = new Date(Date.now() - 1000);
    const expiresAt = new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000);
    const grant = {
      id: 'grant-id',
      authorizationId: ids.authorization,
      scope: PrismaExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
      controllerCredentialId: ids.controller,
      controllerInstallationId: ids.installation,
      machineId: ids.machine,
      userId: ids.user,
      organizationId: ids.organization,
      projectId: ids.project,
      cadence: PrismaControllerAuthorizationCadence.ONE_DAY,
      policyRevision: 1,
      grantDescriptorHash: 'b'.repeat(64),
      targetKind: PrismaHostActionTargetKind.AGENT_SESSION,
      targetId: ids.session,
      allowedActions: [...PRISMA_CURRENT_AGENT_OPERATIONS],
      agentSessionId: null,
      authorizedTurnId: null,
      taskMonitorId: null,
      selectedWorkFingerprint: null,
      policyFingerprint: null,
      issuedAt,
      expiresAt,
      suspendedAt: null,
      terminalAt: null,
      revokedAt: null,
      createdAt: issuedAt,
    };
    db.executionGrant.findUnique.mockResolvedValue({
      authorizationId: ids.authorization,
    });
    db.executionAuthorization.findUnique.mockResolvedValue(
      authorization(interactiveAction(), {
        cadence: PrismaControllerAuthorizationCadence.ONE_DAY,
        issuedAt,
        expiresAt,
        grant,
      }),
    );
    const admission = await service.assertRuntimeModelCatalogAuthorized({
      authorization: { kind: 'bounded_grant', grantId: 'grant-id' },
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      machineId: ids.machine,
      controllerBindingSecret: ids.bindingSecret,
    });
    expect(admission.envelopeAuthorization).toEqual({
      kind: 'bounded_grant',
      grantId: 'grant-id',
    });
    expect(admission.action).toMatchObject({
      actionType: 'CLI_READ',
      targetKind: 'CLI_READ',
      targetId: ids.machine,
    });
    expect(db.executionGrant.create).not.toHaveBeenCalled();
    expect(db.agentSession.findFirst).not.toHaveBeenCalled();
  });
});
