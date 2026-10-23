import {
  CurrentAgentOperation,
  HostActionTargetKind,
  HostAffectingActionType,
} from '../../../generated';
import { ExecutableFrameAuthorizationService } from '../executable-frame-authorization.service';

const future = new Date(Date.now() + 60_000);

function makeHarness(overrides: Record<string, unknown> = {}, hasGrant = true) {
  const authorization = {
    requestId: 'request-1',
    assertionEvidence: null,
    outcome: 'ADMITTED',
    consumedAt: new Date(),
    expiresAt: future,
    machineId: 'machine-1',
    userId: 'user-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    cadence: 'FIVE_MINUTES',
    controllerCredentialId: 'credential-row-1',
    actionType: 'CONVERSATION_TRIGGER',
    actionPayloadHash: 'hash-1',
    targetKind: 'CONVERSATION',
    targetId: 'conversation-1',
    controllerCredential: { revokedAt: null },
  };
  const defaultMachine = {
    id: 'machine-1',
    userId: 'user-1',
    organizationId: 'org-1',
    revokedAt: null,
    authorizationProtocolVersion: 2,
    authorizationState: 'READY',
  };
  const {
    authorization: authorizationOverride,
    machine: machineOverride,
    ...grantOverrides
  } = overrides;
  const grant = {
    id: 'grant-1',
    authorizationId: 'authorization-1',
    controllerCredentialId: 'credential-row-1',
    machineId: 'machine-1',
    userId: 'user-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    cadence: 'FIVE_MINUTES',
    targetKind: 'AGENT_SESSION',
    targetId: 'session-1',
    allowedActions: ['CONVERSATION_TRIGGER'],
    agentSessionId: 'session-1',
    authorizedTurnId: 'turn-1',
    taskMonitorId: null,
    selectedWorkFingerprint: null,
    policyFingerprint: null,
    expiresAt: future,
    suspendedAt: null,
    terminalAt: null,
    revokedAt: null,
    controllerCredential: { revokedAt: null },
    machine: {
      ...defaultMachine,
      ...(machineOverride as Record<string, unknown> | undefined),
    },
    agentSession: { conversationId: 'conversation-1' },
    agentOperations: [],
    ...grantOverrides,
    authorization: {
      ...authorization,
      ...(authorizationOverride as Record<string, unknown> | undefined),
    },
  };
  const findFirst = jest.fn().mockResolvedValue(hasGrant ? grant : null);
  const service = new ExecutableFrameAuthorizationService({
    db: { executionGrant: { findFirst } },
  } as never);
  return { service, findFirst, grant };
}

const request = {
  machineId: 'machine-1' as never,
  userId: 'user-1' as never,
  organizationId: 'org-1' as never,
  projectId: 'project-1' as never,
  actionType: HostAffectingActionType.ConversationTrigger,
  actionPayloadHash: 'hash-1',
  target: {
    kind: HostActionTargetKind.AgentSession,
    id: 'session-1',
    revision: null,
  },
  agentSessionId: 'session-1' as never,
  authorizedTurnId: 'turn-1',
  taskMonitorId: null,
};

describe('ExecutableFrameAuthorizationService', () => {
  it('returns a bounded reference only for an exact active grant', async () => {
    const { service } = makeHarness();

    await expect(service.resolveBoundedGrant(request)).resolves.toEqual({
      kind: 'bounded_grant',
      grantId: 'grant-1',
    });
  });

  it('admits only the workflow trigger correlated to the grant evidence turn', async () => {
    const { service } = makeHarness({
      authorizedTurnId: 'evidence-turn-1',
      agentOperations: [
        {
          kind: 'WORKFLOW_ANSWER',
          state: 'DISPATCH_PENDING',
          messageId: 'evidence-turn-1',
          triggerMessageId: 'workflow-trigger-1',
        },
      ],
    });

    await expect(
      service.resolveBoundedGrant({
        ...request,
        authorizedTurnId: 'workflow-trigger-1',
      }),
    ).resolves.toEqual({ kind: 'bounded_grant', grantId: 'grant-1' });
    await expect(
      service.resolveBoundedGrant({
        ...request,
        authorizedTurnId: 'different-trigger',
      }),
    ).resolves.toBeNull();
  });

  it('uses the grant lifecycle after the creating authorization expires', async () => {
    const { service } = makeHarness({
      authorization: {
        outcome: 'ADMITTED',
        consumedAt: new Date(Date.now() - 180_000),
        expiresAt: new Date(Date.now() - 60_000),
        machineId: 'machine-1',
        userId: 'user-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        cadence: 'FIVE_MINUTES',
        controllerCredentialId: 'credential-row-1',
        actionType: 'CONVERSATION_TRIGGER',
        actionPayloadHash: 'hash-1',
        targetKind: 'CONVERSATION',
        targetId: 'conversation-1',
        controllerCredential: { revokedAt: null },
      },
    });

    await expect(service.resolveBoundedGrant(request)).resolves.toEqual(
      expect.objectContaining({ grantId: 'grant-1' }),
    );
  });

  it('admits a closed follow-on action for the same interactive session', async () => {
    const { service } = makeHarness({
      allowedActions: [
        'CONVERSATION_TRIGGER',
        'CLI_READ',
        'APPLICATION_EFFECT_LAUNCH',
      ],
    });
    const result = await service.resolveBoundedGrant({
      ...request,
      actionType: HostAffectingActionType.ApplicationEffectLaunch,
      actionPayloadHash: 'follow-on-hash',
      target: {
        kind: HostActionTargetKind.ApplicationEffect,
        id: 'effect-1',
        revision: null,
      },
      authorizedTurnId: undefined,
    });
    expect(result).toEqual(expect.objectContaining({ grantId: 'grant-1' }));
  });

  it('admits a complete controller-device window across targets', async () => {
    const { service, findFirst } = makeHarness({
      scope: 'CONTROLLER_DEVICE_WINDOW',
      targetKind: 'CONVERSATION',
      targetId: 'conversation-1',
      allowedActions: Object.values(CurrentAgentOperation),
      agentSessionId: null,
      authorizedTurnId: null,
      agentSession: null,
    });

    await expect(
      service.resolveBoundedGrant({
        ...request,
        actionType: HostAffectingActionType.CliRead,
        actionPayloadHash: 'follow-on-hash',
        conversationId: 'conversation-1',
        authorizedTurnId: undefined,
      }),
    ).resolves.toEqual({ kind: 'bounded_grant', grantId: 'grant-1' });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { scope: 'CONTROLLER_DEVICE_WINDOW' },
            { projectId: 'project-1', agentSessionId: 'session-1' },
          ],
        }),
      }),
    );
  });

  it('requires Task Monitor fingerprints for non-window grants', async () => {
    const { service } = makeHarness({
      scope: 'TASK_MONITOR',
      targetKind: 'TASK_MONITOR',
      targetId: 'monitor-1',
      agentSessionId: null,
      authorizedTurnId: null,
      taskMonitorId: 'monitor-1',
      selectedWorkFingerprint: 'selection-hash',
      policyFingerprint: 'policy-hash',
      authorization: {
        actionType: 'TASK_MONITOR_START',
        actionPayloadHash: 'monitor-hash',
        targetKind: 'TASK_MONITOR',
        targetId: 'monitor-1',
      },
    });

    await expect(
      service.resolveBoundedGrant({
        ...request,
        actionType: HostAffectingActionType.TaskMonitorStart,
        actionPayloadHash: 'monitor-hash',
        target: {
          kind: HostActionTargetKind.TaskMonitor,
          id: 'monitor-1',
          revision: null,
        },
        agentSessionId: null,
        authorizedTurnId: undefined,
        taskMonitorId: 'monitor-1' as never,
      }),
    ).resolves.toBeNull();
  });

  it('admits conversation-trigger delivery from a conversation-originated controller-device window', async () => {
    const { service } = makeHarness({
      scope: 'CONTROLLER_DEVICE_WINDOW',
      targetKind: 'CONVERSATION',
      targetId: 'conversation-1',
      allowedActions: Object.values(CurrentAgentOperation),
      agentSessionId: null,
      authorizedTurnId: null,
      agentSession: null,
    });

    await expect(
      service.resolveBoundedGrant({
        ...request,
        conversationId: 'conversation-1',
        authorizedTurnId: undefined,
      }),
    ).resolves.toEqual({ kind: 'bounded_grant', grantId: 'grant-1' });
  });

  it('reuses a conversation-trigger controller-device window for a later Agent Session', async () => {
    const { service } = makeHarness({
      scope: 'CONTROLLER_DEVICE_WINDOW',
      targetKind: 'AGENT_SESSION',
      targetId: 'session-1',
      allowedActions: Object.values(CurrentAgentOperation),
      agentSessionId: null,
      authorizedTurnId: null,
      agentSession: null,
      authorization: {
        actionType: 'CONVERSATION_TRIGGER',
        targetKind: 'AGENT_SESSION',
        targetId: 'session-1',
      },
    });

    await expect(
      service.resolveBoundedGrant({
        ...request,
        agentSessionId: 'session-2' as never,
        conversationId: 'conversation-2',
        target: {
          kind: HostActionTargetKind.AgentSession,
          id: 'session-2',
          revision: null,
        },
      }),
    ).resolves.toEqual({ kind: 'bounded_grant', grantId: 'grant-1' });
  });

  it.each([
    ['the originating Agent Session', 'session-1', 'conversation-1'],
    ['a later Agent Session', 'session-2', 'conversation-2'],
  ])(
    'reuses a CLI-read controller-device window for Review in %s',
    async (_scenario, agentSessionId, conversationId) => {
      const { service } = makeHarness({
        scope: 'CONTROLLER_DEVICE_WINDOW',
        targetKind: 'AGENT_SESSION',
        targetId: 'session-1',
        allowedActions: Object.values(CurrentAgentOperation),
        agentSessionId: null,
        authorizedTurnId: null,
        agentSession: null,
        authorization: {
          actionType: 'CLI_READ',
          targetKind: 'AGENT_SESSION',
          targetId: 'session-1',
        },
      });

      await expect(
        service.resolveBoundedGrant({
          ...request,
          agentSessionId: agentSessionId as never,
          conversationId,
          target: {
            kind: HostActionTargetKind.AgentSession,
            id: agentSessionId,
            revision: null,
          },
        }),
      ).resolves.toEqual({ kind: 'bounded_grant', grantId: 'grant-1' });
    },
  );

  it('rejects a future host action before querying reusable authority', async () => {
    const { service, findFirst } = makeHarness({
      scope: 'CONTROLLER_DEVICE_WINDOW',
      allowedActions: Object.values(CurrentAgentOperation),
    });

    await expect(
      service.resolveBoundedGrant({
        ...request,
        actionType: 'FUTURE_HOST_ACTION' as HostAffectingActionType,
      }),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('admits fresh CLI-read evidence prepared for the Agent Session', async () => {
    const submissionEvidence = {
      kind: 'controller_assertion',
      intent: { authorizationId: 'authorization-1' },
      credentialId: 'credential-1',
    };
    const findUnique = jest.fn().mockResolvedValue({
      outcome: 'ADMITTED',
      consumedAt: new Date(),
      assertionEvidence: submissionEvidence,
      machineId: 'machine-1',
      userId: 'user-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      actionType: 'CLI_READ',
      actionPayloadHash: 'hash-1',
      targetKind: 'AGENT_SESSION',
      targetId: 'session-1',
      cadence: 'FIVE_MINUTES',
      grant: { id: 'grant-1', cadence: 'FIVE_MINUTES' },
      controllerCredential: {
        credentialId: 'credential-1',
        revokedAt: null,
      },
      machine: {
        id: 'machine-1',
        userId: 'user-1',
        organizationId: 'org-1',
        revokedAt: null,
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
      },
    });
    const service = new ExecutableFrameAuthorizationService({
      db: { executionAuthorization: { findUnique } },
    } as never);

    await expect(
      service.resolveSelectedAuthorization({
        ...request,
        actionType: HostAffectingActionType.CliRead,
        target: {
          kind: HostActionTargetKind.AgentSession,
          id: 'session-1',
          revision: null,
        },
        authorizedTurnId: undefined,
        envelopeAuthorization: {
          ...submissionEvidence,
          grantId: 'grant-1',
        } as never,
      }),
    ).resolves.toEqual({ ...submissionEvidence, grantId: 'grant-1' });

    await expect(
      service.resolveSelectedAuthorization({
        ...request,
        actionType: HostAffectingActionType.CliRead,
        target: {
          kind: HostActionTargetKind.AgentSession,
          id: 'session-1',
          revision: null,
        },
        authorizedTurnId: undefined,
        envelopeAuthorization: submissionEvidence as never,
      }),
    ).resolves.toBeNull();
  });

  it.each([
    ['missing grant', null],
    ['denied authorization', { authorization: { outcome: 'DENIED' } }],
    ['revoked machine', { machine: { revokedAt: new Date() } }],
    ['wrong payload hash', { authorization: { actionPayloadHash: 'other' } }],
    ['suspended grant', { suspendedAt: new Date() }],
    ['terminal grant', { terminalAt: new Date() }],
  ])(
    'denies %s before a frame can be constructed',
    async (_reason, override) => {
      const { service } =
        override === null ? makeHarness({}, false) : makeHarness(override);
      await expect(service.resolveBoundedGrant(request)).resolves.toBeNull();
    },
  );

  it('still denies a host-affecting frame when passive room access has no matching grant', async () => {
    const { service } = makeHarness({}, false);

    await expect(service.resolveBoundedGrant(request)).resolves.toBeNull();
  });
});
