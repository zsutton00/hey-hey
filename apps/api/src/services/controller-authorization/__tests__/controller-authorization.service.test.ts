import { hashControllerAction } from '../../../generated/controller-action-contract';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ControllerAuthorizationCadence as PrismaControllerAuthorizationCadence } from '@prisma/client';
import * as crypto from 'node:crypto';
import {
  CanonicalControllerAuthorizationIntent,
  ControllerAuthorizationCadence,
  ControllerAuthorizationDenialReason,
  HostActionPreparation,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  RuntimeModelCatalogHostActionPreparation,
} from '../../../generated';
import { canonicalizeJcs } from '../../../core/websockets/trigger-canonicalization';
import { OrganizationId, ProjectId, UserId } from '../../../types';
import { ControllerAssertionVerifierService } from '../controller-assertion-verifier.service';
import {
  CONTROLLER_AUTHORIZATION_TTL_MS,
  CONTROLLER_DEVICE_POLICY_REVISION,
  CURRENT_AGENT_OPERATIONS,
  CURRENT_AGENT_OPERATION_CATEGORIES,
  PRISMA_CURRENT_AGENT_OPERATIONS,
  ControllerAuthorizationPreparationDeniedException,
  ControllerAuthorizationService,
  buildControllerDeviceGrantDescriptor,
  getControllerDeviceGrantExpiry,
  hashControllerDeviceGrantDescriptor,
} from '../controller-authorization.service';
import { ControllerAuthorizationWebAuthnConfigService } from '../controller-authorization-webauthn-config.service';

const ids = {
  authorization: '11111111-1111-4111-8111-111111111111',
  controller: '22222222-2222-4222-8222-222222222222',
  installation: '2a2a2a2a-2222-4222-8222-222222222222',
  machine: '33333333-3333-4333-8333-333333333333',
  user: '44444444-4444-4444-8444-444444444444' as UserId,
  organization: '55555555-5555-4555-8555-555555555555' as OrganizationId,
  project: '66666666-6666-4666-8666-666666666666' as ProjectId,
  conversation: '77777777-7777-4777-8777-777777777777',
  request: '88888888-8888-4888-8888-888888888888',
  agentSession: '99999999-9999-4999-8999-999999999999',
  taskMonitor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  unresolvedTarget: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  bindingSecret: 'controller-binding-secret',
};
const controllerCredentialId = 'controller-credential';

const action = {
  requestId: ids.request,
  actionCategory: HostActionCategory.Conversation,
  actionType: HostAffectingActionType.ConversationTrigger,
  targetKind: 'AGENT_SESSION',
  targetId: ids.agentSession,
} satisfies HostActionPreparation;

const prepareInput = (inputAction: HostActionPreparation) => ({
  machineId: ids.machine,
  controllerCredentialId,
  cadence: ControllerAuthorizationCadence.OneDay,
  action: inputAction,
});

describe('ControllerAuthorizationService', () => {
  const keyPair = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const publicJwk = keyPair.publicKey.export({ format: 'jwk' });
  const publicX = Buffer.from(publicJwk.x!, 'base64url');
  const publicY = Buffer.from(publicJwk.y!, 'base64url');

  let db: any;
  let service: ControllerAuthorizationService;
  let verifier: ControllerAssertionVerifierService;
  let browserBindingService: {
    resolveForAdmission: jest.Mock;
    resolveForSelection: jest.Mock;
    issueOrRotate: jest.Mock;
  };

  beforeEach(() => {
    db = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: ids.project }) },
      machine: { findFirst: jest.fn().mockResolvedValue({ id: ids.machine }) },
      machineControllerCredential: {
        findFirst: jest.fn().mockResolvedValue({
          id: ids.controller,
          credentialId: controllerCredentialId,
          credentialTransports: ['internal'],
          credentialFingerprint: 'a'.repeat(64),
          controllerInstallationId: ids.installation,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      conversation: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: ids.conversation, version: 7 }),
      },
      agentSession: {
        findFirst: jest.fn().mockResolvedValue({ id: ids.agentSession }),
      },
      task: { findFirst: jest.fn() },
      executionAuthorization: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      executionGrant: { findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    db.$transaction = jest.fn(async (callback: (tx: any) => unknown) =>
      callback(db),
    );
    const config = new ControllerAuthorizationWebAuthnConfigService(
      new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      }),
    );
    verifier = new ControllerAssertionVerifierService(config);
    browserBindingService = {
      resolveForAdmission: jest.fn().mockResolvedValue({
        controllerInstallationId: ids.installation,
        controllerCredentialId: ids.controller,
        controllerCredentialPublicId: controllerCredentialId,
        machineId: ids.machine,
        userId: ids.user,
        organizationId: ids.organization,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      }),
      resolveForSelection: jest.fn().mockResolvedValue({
        controllerInstallationId: ids.installation,
        controllerCredentialId: ids.controller,
      }),
      issueOrRotate: jest.fn().mockResolvedValue({
        secret: 'rotated-binding-secret',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      }),
    };
    service = new ControllerAuthorizationService(
      { db } as any,
      { isPresent: jest.fn().mockResolvedValue(true) } as any,
      verifier,
      config,
      browserBindingService as any,
      {
        resolveStartRunConfiguration: jest.fn().mockResolvedValue(undefined),
      } as any,
    );
    const submitWithBinding = service.submit.bind(service);
    service.submit = (async (
      params: Parameters<ControllerAuthorizationService['submit']>[0],
    ) => (await submitWithBinding(params)).response) as any;
  });

  it('returns a matching active bounded-grant reference without proof material', async () => {
    const expiresAt = new Date('2099-01-01T00:00:00.000Z');
    db.executionGrant.findFirst.mockResolvedValue({
      id: 'active-grant',
      expiresAt,
      allowedActions: [...PRISMA_CURRENT_AGENT_OPERATIONS],
    });

    await expect(
      service.resolve({
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        controllerBindingSecret: ids.bindingSecret,
        input: {
          machineId: ids.machine,
          action,
        },
      }),
    ).resolves.toEqual({
      outcome: 'ACTIVE_GRANT',
      authorization: { kind: 'bounded_grant', grantId: 'active-grant' },
      effectiveExpiresAtMs: expiresAt.getTime(),
    });
    expect(db.executionGrant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          controllerInstallationId: ids.installation,
          machineId: ids.machine,
          userId: ids.user,
          organizationId: ids.organization,
          cadence: {
            notIn: [
              PrismaControllerAuthorizationCadence.EVERY_ACTION,
              PrismaControllerAuthorizationCadence.CURRENT_BROWSER_SESSION,
            ],
          },
          suspendedAt: null,
          terminalAt: null,
          revokedAt: null,
        }),
        select: { id: true, expiresAt: true, allowedActions: true },
      }),
    );
  });

  it('requires fresh authorization when the browser binding is absent', async () => {
    browserBindingService.resolveForAdmission.mockResolvedValue(null);

    await expect(
      service.resolve({
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        controllerBindingSecret: undefined,
        input: {
          machineId: ids.machine,
          action,
        },
      }),
    ).resolves.toEqual({ outcome: 'AUTHORIZATION_REQUIRED' });
    expect(db.executionGrant.findFirst).not.toHaveBeenCalled();
  });

  it('resolves a machine-addressed model catalog read instead of denying it as an action mismatch', async () => {
    await expect(
      service.resolve({
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        controllerBindingSecret: ids.bindingSecret,
        input: {
          machineId: ids.machine,
          action: {
            requestId: ids.request,
            actionCategory:
              RuntimeModelCatalogHostActionPreparation.ActionCategoryEnum
                .CliRead,
            actionType:
              RuntimeModelCatalogHostActionPreparation.ActionTypeEnum.CliRead,
            targetKind:
              RuntimeModelCatalogHostActionPreparation.TargetKindEnum.CliRead,
            targetId: ids.machine,
          },
        },
      }),
    ).resolves.toEqual({ outcome: 'AUTHORIZATION_REQUIRED' });
  });

  it('still rejects a machine-addressed read carrying unexpected fields', async () => {
    await expect(
      service.resolve({
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        controllerBindingSecret: ids.bindingSecret,
        input: {
          machineId: ids.machine,
          action: {
            requestId: ids.request,
            actionCategory: HostActionCategory.CliRead,
            actionType: HostAffectingActionType.CliRead,
            targetKind: HostActionTargetKind.CliRead,
            targetId: ids.machine,
            provider: 'claude',
          },
        } as any,
      }),
    ).rejects.toMatchObject({
      reason: ControllerAuthorizationDenialReason.ActionMismatch,
    });
  });

  it('requires fresh authorization when no bounded grant matches', async () => {
    await expect(
      service.resolve({
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        controllerBindingSecret: ids.bindingSecret,
        input: {
          machineId: ids.machine,
          action,
        },
      }),
    ).resolves.toEqual({ outcome: 'AUTHORIZATION_REQUIRED' });
  });

  it.each([
    [ControllerAuthorizationCadence.FiveMinutes, 5 / (24 * 60)],
    [ControllerAuthorizationCadence.EightHours, 8 / 24],
    [ControllerAuthorizationCadence.OneDay, 1],
    [ControllerAuthorizationCadence.OneWeek, 7],
    [ControllerAuthorizationCadence.OneMonth, 30],
  ])('derives the API-owned expiry for %s', (cadence, days) => {
    const issuedAt = new Date('2026-08-19T00:00:00.000Z');
    expect(getControllerDeviceGrantExpiry(issuedAt, cadence)).toEqual(
      new Date(issuedAt.getTime() + days * 24 * 60 * 60 * 1000),
    );
  });

  it.each([
    PrismaControllerAuthorizationCadence.EVERY_ACTION,
    PrismaControllerAuthorizationCadence.CURRENT_BROWSER_SESSION,
  ])(
    'denies a pending authorization with removed cadence %s',
    async (cadence) => {
      const record = authorizationRecord();
      record.cadence = cadence;
      db.executionAuthorization.findUnique.mockResolvedValue(record);

      await expect(
        service.submit({
          organizationId: ids.organization,
          projectId: ids.project,
          userId: ids.user,
          input: {
            authorizationId: record.id,
            assertion: signAssertion(record),
          },
        }),
      ).resolves.toEqual({
        outcome: 'DENIED',
        reason: ControllerAuthorizationDenialReason.ActionMismatch,
        retryable: false,
      });
    },
  );

  it('binds every submitted read input before creating the WebAuthn challenge', async () => {
    const readAction: HostActionPreparation = {
      ...action,
      actionCategory: HostActionCategory.CliRead,
      actionType: HostAffectingActionType.CliRead,
      inputs: {
        kind: 'CLI_READ',
        body: {
          requestId: ids.request,
          agentSessionId: ids.agentSession,
          operation: 'run.changed_files.detail',
          runId: ids.agentSession,
          file: {
            serviceId: ids.taskMonitor,
            repoPath: '/workspace',
            filePath: 'src/approved.ts',
          },
        },
      },
    };
    const approved = await service.prepare({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      input: prepareInput(readAction),
    });
    expect(approved.intent.actionPayloadHash).toBe(
      hashControllerAction(readAction),
    );
    const changed: HostActionPreparation = {
      ...readAction,
      requestId: crypto.randomUUID(),
      inputs: {
        kind: 'CLI_READ',
        body: {
          requestId: ids.request,
          agentSessionId: ids.agentSession,
          operation: 'run.changed_files.detail',
          runId: ids.agentSession,
          file: {
            serviceId: ids.taskMonitor,
            repoPath: '/workspace',
            filePath: 'src/changed.ts',
          },
        },
      },
    };
    const other = await service.prepare({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      input: prepareInput(changed),
    });
    expect(other.intent.actionPayloadHash).not.toBe(
      approved.intent.actionPayloadHash,
    );
    expect(db.executionAuthorization.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionPayloadHash: hashControllerAction(changed),
        }),
      }),
    );
  });

  it('persists the exact canonical two-minute intent and fixed request options', async () => {
    const before = Date.now();
    const result = await service.prepare({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      input: prepareInput(action),
    });

    expect(result.intent.actionPayloadHash).toBe(hashControllerAction(action));
    expect(result.intent.controllerCredentialId).toBe(controllerCredentialId);
    expect(result.intent.controllerCredentialId).not.toBe(ids.controller);
    expect(result.intent.target).toEqual({
      kind: 'AGENT_SESSION',
      id: ids.agentSession,
      revision: null,
    });
    expect(result.intent.expiresAtMs - result.intent.issuedAtMs).toBe(
      CONTROLLER_AUTHORIZATION_TTL_MS,
    );
    expect(result.intent.issuedAtMs).toBeGreaterThanOrEqual(before);
    expect(result.grantDescriptor).toEqual({
      scope: 'controller_device_window',
      controllerCredentialId,
      controllerInstallationId: ids.installation,
      machineId: ids.machine,
      userId: ids.user,
      organizationId: ids.organization,
      cadence: ControllerAuthorizationCadence.OneDay,
      policyRevision: CONTROLLER_DEVICE_POLICY_REVISION,
      allowedActionTypes: result.intent.allowedActionTypes,
      allowedActionCategories: result.intent.allowedActionCategories,
      issuedAtMs: result.intent.issuedAtMs,
      effectiveExpiresAtMs: result.intent.effectiveGrantExpiresAtMs,
    });
    expect(hashControllerDeviceGrantDescriptor(result.grantDescriptor)).toBe(
      result.intent.grantDescriptorHash,
    );
    expect(result.publicKey).toEqual({
      challenge: service.buildChallenge(canonicalizeJcs(result.intent)),
      rpId: 'test.heyhey.dev',
      timeout: 120000,
      userVerification: 'required',
      allowCredentials: [
        {
          type: 'public-key',
          id: 'controller-credential',
          transports: new Set(['internal']),
        },
      ],
    });
    expect(
      JSON.parse(JSON.stringify(result)).publicKey.allowCredentials,
    ).toEqual([
      {
        type: 'public-key',
        id: 'controller-credential',
        transports: ['internal'],
      },
    ]);
    expect(db.executionAuthorization.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        canonicalIntent: canonicalizeJcs(result.intent),
        webauthnChallenge: result.publicKey.challenge,
        controllerCredentialId: ids.controller,
        machineId: ids.machine,
        userId: ids.user,
        organizationId: ids.organization,
        projectId: ids.project,
        grantDescriptorHash: result.intent.grantDescriptorHash,
        actionPayloadHash: result.intent.actionPayloadHash,
        nonce: result.intent.nonce,
      }),
    });
  });

  it('rejects target revision substitution before persistence', async () => {
    await expect(
      service.prepare({
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        input: prepareInput({
          ...action,
          targetRevision: 8,
        } as unknown as HostActionPreparation),
      }),
    ).rejects.toMatchObject({
      reason: ControllerAuthorizationDenialReason.ActionMismatch,
    });
    expect(db.executionAuthorization.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'CONVERSATION',
      HostActionCategory.Conversation,
      HostAffectingActionType.ConversationTrigger,
      ids.conversation,
    ],
    [
      'AGENT_SESSION',
      HostActionCategory.Conversation,
      HostAffectingActionType.ConversationTrigger,
      ids.agentSession,
    ],
    [
      'TASK_MONITOR',
      HostActionCategory.TaskMonitor,
      HostAffectingActionType.TaskMonitorStart,
      ids.taskMonitor,
    ],
  ])(
    'rejects targetRevision on the closed %s action shape',
    async (targetKind, actionCategory, actionType, targetId) => {
      await expect(
        service.prepare({
          organizationId: ids.organization,
          projectId: ids.project,
          userId: ids.user,
          input: prepareInput({
            requestId: ids.request,
            actionCategory,
            actionType,
            targetKind,
            targetId,
            targetRevision: 8,
          } as unknown as HostActionPreparation),
        }),
      ).rejects.toMatchObject({
        reason: ControllerAuthorizationDenialReason.ActionMismatch,
      });
      expect(db.executionAuthorization.create).not.toHaveBeenCalled();
    },
  );

  it('rejects target identity substitution before persistence', async () => {
    db.agentSession.findFirst.mockResolvedValue(null);

    await expect(
      service.prepare({
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        input: prepareInput({ ...action, targetId: ids.unresolvedTarget }),
      }),
    ).rejects.toMatchObject({
      reason: ControllerAuthorizationDenialReason.TargetMismatch,
    });
    expect(db.agentSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: ids.unresolvedTarget,
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        machineId: ids.machine,
      },
      select: { id: true },
    });
    expect(db.executionAuthorization.create).not.toHaveBeenCalled();
  });

  it('resolves an Agent Session only from the trusted account, scope, and machine context', async () => {
    const sessionAction = {
      requestId: ids.request,
      actionCategory: HostActionCategory.AuthorityIncreasingControl,
      actionType: HostAffectingActionType.ConversationControlCompactRun,
      targetKind: 'AGENT_SESSION',
      targetId: ids.agentSession,
    } satisfies HostActionPreparation;
    db.agentSession.findFirst.mockResolvedValue({ id: ids.agentSession });

    const result = await service.prepare({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      input: prepareInput(sessionAction),
    });

    expect(db.agentSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: ids.agentSession,
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        machineId: ids.machine,
      },
      select: { id: true },
    });
    expect(result.intent).toMatchObject({
      actionCategory: HostActionCategory.AuthorityIncreasingControl,
      actionType: HostAffectingActionType.ConversationControlCompactRun,
      actionPayloadHash: crypto
        .createHash('sha256')
        .update(canonicalizeJcs(sessionAction))
        .digest('hex'),
      target: {
        kind: HostActionTargetKind.AgentSession,
        id: ids.agentSession,
        revision: null,
      },
      agentSessionId: ids.agentSession,
      taskMonitorId: null,
    });
  });

  it('returns a typed safe denial for an Agent Session outside trusted scope', async () => {
    db.agentSession.findFirst.mockResolvedValue(null);

    const preparation = service.prepare({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      input: prepareInput({
        requestId: ids.request,
        actionCategory: HostActionCategory.AuthorityIncreasingControl,
        actionType:
          HostAffectingActionType.ConversationControlPermissionDecision,
        targetKind: 'AGENT_SESSION',
        targetId: ids.agentSession,
      }),
    });

    await expect(preparation).rejects.toBeInstanceOf(
      ControllerAuthorizationPreparationDeniedException,
    );
    await expect(preparation).rejects.toMatchObject({
      reason: ControllerAuthorizationDenialReason.TargetMismatch,
    });
    expect(db.executionAuthorization.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      HostAffectingActionType.TaskMonitorStart,
      HostActionCategory.TaskMonitor,
      'TASK_MONITOR',
      ids.taskMonitor,
    ],
    [
      HostAffectingActionType.CliRead,
      HostActionCategory.CliRead,
      'AGENT_SESSION',
      ids.unresolvedTarget,
    ],
  ])(
    'rejects unresolved %s targets instead of accepting browser scope',
    async (actionType, actionCategory, targetKind, targetId) => {
      if (targetId === ids.unresolvedTarget) {
        db.agentSession.findFirst.mockResolvedValue(null);
      }
      await expect(
        service.prepare({
          organizationId: ids.organization,
          projectId: ids.project,
          userId: ids.user,
          input: prepareInput({
            requestId: ids.request,
            actionCategory,
            actionType,
            targetKind,
            targetId,
          } as unknown as HostActionPreparation),
        }),
      ).rejects.toMatchObject({
        reason: ControllerAuthorizationDenialReason.TargetMismatch,
      });
      expect(db.executionAuthorization.create).not.toHaveBeenCalled();
    },
  );

  it('verifies and atomically consumes one matching ES256 assertion', async () => {
    const record = authorizationRecord();
    db.executionAuthorization.findUnique.mockResolvedValue(record);
    const assertion = signAssertion(record);

    const result = await service.submit({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      input: { authorizationId: record.id, assertion },
    });

    expect(result).toEqual({
      outcome: 'ADMITTED',
      authorizationId: record.id,
      consumedAt: expect.any(String),
      grantId: null,
    });
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.executionAuthorization.updateMany).toHaveBeenCalledWith({
      where: {
        id: record.id,
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        consumedAt: expect.any(Date),
        assertionEvidence: assertion,
        outcome: 'ADMITTED',
        outcomeRecordedAt: expect.any(Date),
      },
    });
  });

  it.each([
    [
      'expired',
      { expiresAt: new Date(Date.now() - 1) },
      'AUTHORIZATION_EXPIRED',
    ],
    ['replayed', { consumedAt: new Date() }, 'AUTHORIZATION_ALREADY_CONSUMED'],
    [
      'revoked controller',
      { controllerRevokedAt: new Date() },
      'CONTROLLER_NOT_ACTIVE',
    ],
  ])('denies %s state without consuming', async (_label, override, reason) => {
    const record = authorizationRecord(override);
    db.executionAuthorization.findUnique.mockResolvedValue(record);
    const result = await service.submit({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      input: { authorizationId: record.id, assertion: signAssertion(record) },
    });
    expect(result).toEqual({
      outcome: 'DENIED',
      reason,
      retryable: reason !== 'AUTHORIZATION_ALREADY_CONSUMED',
    });
    expect(db.executionAuthorization.updateMany).not.toHaveBeenCalled();
  });

  it('denies intent and payload substitution without invoking crypto', async () => {
    const record = authorizationRecord();
    db.executionAuthorization.findUnique.mockResolvedValue(record);
    const assertion = signAssertion(record);
    assertion.intent = {
      ...assertion.intent,
      actionPayloadHash: 'b'.repeat(64),
    };
    const verifySpy = jest.spyOn(verifier, 'verify');

    const result = await service.submit({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      input: { authorizationId: record.id, assertion },
    });

    expect(result).toEqual({
      outcome: 'DENIED',
      reason: 'ACTION_MISMATCH',
      retryable: false,
    });
    expect(verifySpy).not.toHaveBeenCalled();
    expect(db.executionAuthorization.updateMany).not.toHaveBeenCalled();
  });

  it('denies grant descriptor substitution without invoking crypto', async () => {
    const record = authorizationRecord();
    db.executionAuthorization.findUnique.mockResolvedValue(record);
    const assertion = signAssertion(record);
    assertion.grantDescriptor = {
      ...assertion.grantDescriptor,
      cadence: ControllerAuthorizationCadence.OneWeek,
    };
    const verifySpy = jest.spyOn(verifier, 'verify');

    const result = await service.submit({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      input: { authorizationId: record.id, assertion },
    });

    expect(result).toEqual({
      outcome: 'DENIED',
      reason: ControllerAuthorizationDenialReason.PayloadHashMismatch,
      retryable: false,
    });
    expect(verifySpy).not.toHaveBeenCalled();
    expect(db.executionAuthorization.updateMany).not.toHaveBeenCalled();
  });

  it('does not invalidate exact conversation authority when the conversation version advances', async () => {
    const record = authorizationRecord();
    db.executionAuthorization.findUnique.mockResolvedValue(record);
    db.agentSession.findFirst.mockResolvedValue({ id: ids.agentSession });

    await expect(
      service.submit({
        organizationId: ids.organization,
        projectId: ids.project,
        userId: ids.user,
        input: {
          authorizationId: record.id,
          assertion: signAssertion(record),
        },
      }),
    ).resolves.toMatchObject({ outcome: 'ADMITTED' });
  });

  it('denies an unresolved target before assertion verification or consumption', async () => {
    const record = authorizationRecord();
    db.executionAuthorization.findUnique.mockResolvedValue(record);
    db.agentSession.findFirst.mockResolvedValue(null);
    const verifySpy = jest.spyOn(verifier, 'verify');

    const result = await service.submit({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      input: {
        authorizationId: record.id,
        assertion: signAssertion(record),
      },
    });

    expect(result).toEqual({
      outcome: 'DENIED',
      reason: ControllerAuthorizationDenialReason.TargetMismatch,
      retryable: false,
    });
    expect(verifySpy).not.toHaveBeenCalled();
    expect(db.executionAuthorization.updateMany).not.toHaveBeenCalled();
  });

  it('treats a non-monotonic authenticator counter as telemetry for synced passkeys', async () => {
    const record = authorizationRecord();
    record.controllerCredential.credentialSignCount = 2;
    db.executionAuthorization.findUnique.mockResolvedValue(record);

    const result = await service.submit({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      input: {
        authorizationId: record.id,
        assertion: signAssertion(record),
      },
    });

    expect(result).toEqual({
      outcome: 'ADMITTED',
      authorizationId: record.id,
      consumedAt: expect.any(String),
      grantId: null,
    });
    expect(db.executionAuthorization.updateMany).toHaveBeenCalled();
    expect(db.machineControllerCredential.update).toHaveBeenCalledWith({
      where: { id: ids.controller },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it.each([
    [
      'origin substitution',
      { origin: 'https://evil.example' },
      ControllerAuthorizationDenialReason.OriginMismatch,
    ],
    [
      'RP ID substitution',
      { rpId: 'evil.example' },
      ControllerAuthorizationDenialReason.RpIdMismatch,
    ],
    [
      'missing user presence',
      { flags: 0x04 },
      ControllerAuthorizationDenialReason.UserPresenceRequired,
    ],
    [
      'missing user verification',
      { flags: 0x01 },
      ControllerAuthorizationDenialReason.UserVerificationRequired,
    ],
    [
      'cross-origin ceremony',
      { crossOrigin: true },
      ControllerAuthorizationDenialReason.OriginMismatch,
    ],
  ])('safely denies %s', async (_label, assertionOptions, reason) => {
    const record = authorizationRecord();
    db.executionAuthorization.findUnique.mockResolvedValue(record);
    const result = await service.submit({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      input: {
        authorizationId: record.id,
        assertion: signAssertion(record, assertionOptions),
      },
    });
    expect(result).toEqual({ outcome: 'DENIED', reason, retryable: false });
    expect(db.executionAuthorization.updateMany).not.toHaveBeenCalled();
  });

  it('logs only stable identifiers, hashes, and reason codes on denial', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const record = authorizationRecord();
    db.executionAuthorization.findUnique.mockResolvedValue(record);
    const assertion = signAssertion(record);
    assertion.signature = Buffer.from('invalid').toString('base64url');

    await service.submit({
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.user,
      input: { authorizationId: record.id, assertion },
    });

    const serialized = JSON.stringify(warn.mock.calls);
    expect(serialized).toContain('SIGNATURE_INVALID');
    expect(serialized).not.toContain(assertion.clientDataJSON);
    expect(serialized).not.toContain(assertion.authenticatorData);
    expect(serialized).not.toContain(assertion.signature);
    warn.mockRestore();
  });

  function authorizationRecord(
    override: {
      expiresAt?: Date;
      consumedAt?: Date;
      controllerRevokedAt?: Date;
    } = {},
  ): any {
    const issuedAt = new Date();
    const expiresAt =
      override.expiresAt ??
      new Date(issuedAt.getTime() + CONTROLLER_AUTHORIZATION_TTL_MS);
    const actionPayloadHash = hashControllerAction(action);
    const grantDescriptorHash = hashControllerDeviceGrantDescriptor(
      buildControllerDeviceGrantDescriptor({
        controllerCredentialId: controllerCredentialId,
        controllerInstallationId: ids.installation,
        machineId: ids.machine,
        userId: ids.user,
        organizationId: ids.organization,
        projectId: ids.project,
        action,
        actionPayloadHash,
        target: {
          kind: HostActionTargetKind.AgentSession,
          id: ids.agentSession,
          revision: null,
          agentSessionId: ids.agentSession,
          taskMonitorId: null,
        },
        allowedActions: [
          HostAffectingActionType.ConversationTrigger,
          HostAffectingActionType.CliRead,
          HostAffectingActionType.ApplicationEffectLaunch,
          HostAffectingActionType.ConversationControlCompactRun,
          HostAffectingActionType.ConversationControlPermissionDecision,
        ],
        cadence: ControllerAuthorizationCadence.OneDay,
        policyRevision: CONTROLLER_DEVICE_POLICY_REVISION,
        issuedAt,
      }),
    );
    const intent = {
      version: 2,
      authorizationId: ids.authorization,
      controllerCredentialId: controllerCredentialId,
      controllerInstallationId: ids.installation,
      machineId: ids.machine,
      userId: ids.user,
      organizationId: ids.organization,
      projectId: ids.project,
      cadence: ControllerAuthorizationCadence.OneDay,
      policyRevision: CONTROLLER_DEVICE_POLICY_REVISION,
      effectiveGrantExpiresAtMs: getControllerDeviceGrantExpiry(
        issuedAt,
        ControllerAuthorizationCadence.OneDay,
      ).getTime(),
      grantDescriptorHash,
      actionCategory: HostActionCategory.Conversation,
      actionType: HostAffectingActionType.ConversationTrigger,
      actionPayloadHash,
      allowedActionTypes: [...CURRENT_AGENT_OPERATIONS],
      allowedActionCategories: [...CURRENT_AGENT_OPERATION_CATEGORIES],
      target: {
        kind: HostActionTargetKind.AgentSession,
        id: ids.agentSession,
        revision: null,
      },
      agentSessionId: ids.agentSession,
      taskMonitorId: null,
      nonce: Buffer.alloc(32, 7).toString('base64url'),
      issuedAtMs: issuedAt.getTime(),
      expiresAtMs: expiresAt.getTime(),
    } satisfies CanonicalControllerAuthorizationIntent;
    return {
      id: ids.authorization,
      requestId: ids.request,
      canonicalIntent: canonicalizeJcs(intent),
      webauthnChallenge: service.buildChallenge(canonicalizeJcs(intent)),
      controllerCredentialId: ids.controller,
      controllerInstallationId: ids.installation,
      machineId: ids.machine,
      userId: ids.user,
      organizationId: ids.organization,
      projectId: ids.project,
      cadence: ControllerAuthorizationCadence.OneDay,
      policyRevision: CONTROLLER_DEVICE_POLICY_REVISION,
      grantDescriptorHash,
      actionCategory: intent.actionCategory,
      actionType: intent.actionType,
      actionPayloadHash: intent.actionPayloadHash,
      targetKind: intent.target.kind,
      targetId: intent.target.id,
      agentSessionId: ids.agentSession,
      taskMonitorId: null,
      nonce: intent.nonce,
      issuedAt,
      expiresAt,
      consumedAt: override.consumedAt ?? null,
      outcome: null,
      outcomeReason: null,
      outcomeRecordedAt: null,
      createdAt: issuedAt,
      controllerCredential: {
        id: ids.controller,
        credentialId: controllerCredentialId,
        credentialPublicKeyX: publicX,
        credentialPublicKeyY: publicY,
        credentialSignCount: 0,
        credentialFingerprint: 'c'.repeat(64),
        userId: ids.user,
        machineId: ids.machine,
        organizationId: ids.organization,
        revokedAt: override.controllerRevokedAt ?? null,
      },
      machine: {
        id: ids.machine,
        userId: ids.user,
        organizationId: ids.organization,
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
        revokedAt: null,
      },
    };
  }

  function signAssertion(
    record: any,
    options: {
      origin?: string;
      rpId?: string;
      flags?: number;
      crossOrigin?: boolean;
    } = {},
  ): any {
    const intent = JSON.parse(
      record.canonicalIntent,
    ) as CanonicalControllerAuthorizationIntent;
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: record.webauthnChallenge,
        origin: options.origin ?? 'https://test.heyhey.dev',
        ...(options.crossOrigin === undefined
          ? {}
          : { crossOrigin: options.crossOrigin }),
      }),
    );
    const authenticatorData = Buffer.alloc(37);
    crypto
      .createHash('sha256')
      .update(options.rpId ?? 'test.heyhey.dev')
      .digest()
      .copy(authenticatorData, 0);
    authenticatorData[32] = options.flags ?? 0x05;
    authenticatorData.writeUInt32BE(1, 33);
    const signedBytes = Buffer.concat([
      authenticatorData,
      crypto.createHash('sha256').update(clientDataJSON).digest(),
    ]);
    return {
      kind: 'controller_assertion',
      intent,
      credentialId: controllerCredentialId,
      clientDataJSON: clientDataJSON.toString('base64url'),
      authenticatorData: authenticatorData.toString('base64url'),
      signature: crypto
        .sign('sha256', signedBytes, keyPair.privateKey)
        .toString('base64url'),
      userHandle: Buffer.from(ids.user).toString('base64url'),
      grantDescriptor: {
        scope: 'controller_device_window',
        controllerCredentialId: intent.controllerCredentialId,
        controllerInstallationId: intent.controllerInstallationId,
        machineId: intent.machineId,
        userId: intent.userId,
        organizationId: intent.organizationId,
        cadence: intent.cadence,
        policyRevision: intent.policyRevision,
        allowedActionTypes: intent.allowedActionTypes,
        allowedActionCategories: intent.allowedActionCategories,
        issuedAtMs: intent.issuedAtMs,
        effectiveExpiresAtMs: intent.effectiveGrantExpiresAtMs,
      },
    };
  }
});
