import { hashControllerAction } from '../../../generated/controller-action-contract';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import {
  CanonicalControllerAuthorizationIntent,
  ControllerAuthorizationCadence,
  ControllerAuthorizationDenialReason,
  HostActionCategory,
  HostActionPreparation,
  HostActionTargetKind,
  HostAffectingActionType,
  TaskMonitorExternalCommand,
} from '../../../generated';
import { canonicalizeJcs } from '../../../core/websockets/trigger-canonicalization';
import { PrismaService } from '../../../prisma/prisma.service';
import { ControllerAssertionVerifierService } from '../controller-assertion-verifier.service';
import {
  ControllerAuthorizationService,
  CONTROLLER_AUTHORIZATION_TTL_MS,
  CONTROLLER_DEVICE_POLICY_REVISION,
  CURRENT_AGENT_OPERATIONS,
  CURRENT_AGENT_OPERATION_CATEGORIES,
  buildControllerDeviceGrantDescriptor,
  hashControllerDeviceGrantDescriptor,
  getControllerDeviceGrantExpiry,
} from '../controller-authorization.service';
import { ControllerAuthorizationWebAuthnConfigService } from '../controller-authorization-webauthn-config.service';
import {
  ExecutionGrantAdmissionDeniedException,
  ExecutionGrantService,
} from '../execution-grant.service';

const describeDatabase =
  process.env.RUN_CONTROLLER_AUTHORIZATION_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

type Fixture = {
  user: { id: string };
  organization: { id: string };
  project: { id: string };
  conversation: { id: string; version: number };
  session: { id: string };
  turn: { id: string };
  monitor: {
    id: string;
    revision: number;
    sectionId: string;
    executionDefinition: Record<string, any>;
  };
  machine: { id: string };
  controller: { id: string; credentialId: string };
  enrollment: { id: string };
};

type AuthorizationFixture = {
  id: string;
  requestId: string;
  action: HostActionPreparation;
  intent: CanonicalControllerAuthorizationIntent;
  canonicalIntent: string;
  webauthnChallenge: string;
  controllerCredentialId: string;
  userId: string;
  assertion: any;
};

const sha256Hex = (value: string): string =>
  crypto.createHash('sha256').update(value, 'utf8').digest('hex');

const waitFor = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const bindingSecretFor = (fixture: Fixture): string =>
  JSON.stringify({
    controllerInstallationId: fixture.enrollment.id,
    controllerCredentialId: fixture.controller.id,
    controllerCredentialPublicId: fixture.controller.credentialId,
    machineId: fixture.machine.id,
    userId: fixture.user.id,
    organizationId: fixture.organization.id,
    expiresAt: new Date(Date.now() + 60_000),
  });

describeDatabase(
  'Controller authorization and execution grant PostgreSQL invariants',
  () => {
    let prisma: PrismaService;
    let authorizationService: ControllerAuthorizationService;
    let grantService: ExecutionGrantService;
    let verifier: ControllerAssertionVerifierService;
    let config: ConfigService;
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;

    const fixtures: Fixture[] = [];
    const authorizationIds: string[] = [];
    const forbiddenMaterial: string[] = [];
    const keyPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const publicJwk = keyPair.publicKey.export({ format: 'jwk' });
    const publicKeyX = Buffer.from(publicJwk.x!, 'base64url');
    const publicKeyY = Buffer.from(publicJwk.y!, 'base64url');

    beforeAll(async () => {
      prisma = new PrismaService();
      await prisma.$connect();
      config = new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      });
      const webauthnConfig = new ControllerAuthorizationWebAuthnConfigService(
        config,
      );
      verifier = new ControllerAssertionVerifierService(webauthnConfig);
      const browserBindingService = {
        resolveForAdmission: jest
          .fn()
          .mockImplementation(({ secret }) =>
            Promise.resolve(secret ? JSON.parse(secret) : null),
          ),
        issueOrRotate: jest.fn().mockResolvedValue({
          secret: 'rotated-binding-secret',
          expiresAt: new Date(Date.now() + 60_000),
        }),
      } as any;
      authorizationService = new ControllerAuthorizationService(
        prisma,
        { isPresent: jest.fn().mockResolvedValue(true) } as any,
        verifier,
        webauthnConfig,
        browserBindingService,
        {
          resolveStartRunConfiguration: jest.fn().mockResolvedValue(undefined),
        } as any,
      );
      grantService = new ExecutionGrantService(
        prisma,
        browserBindingService,
        authorizationService,
      );
      logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
    });

    afterEach(async () => {
      const ids = authorizationIds.splice(0);
      const currentFixtures = fixtures.splice(0);
      if (ids.length > 0) {
        await prisma.db.executionGrant.deleteMany({
          where: { authorizationId: { in: ids } },
        });
        await prisma.db.executionAuthorization.deleteMany({
          where: { id: { in: ids } },
        });
      }

      for (const fixture of currentFixtures) {
        await prisma.db.message.deleteMany({
          where: { id: fixture.turn.id },
        });
        await prisma.db.task.deleteMany({
          where: { id: fixture.monitor.id },
        });
        await prisma.db.agentSession.deleteMany({
          where: { id: fixture.session.id },
        });
        await prisma.db.conversation.deleteMany({
          where: { id: fixture.conversation.id },
        });
        await prisma.db.machineControllerCredential.deleteMany({
          where: { id: fixture.controller.id },
        });
        await prisma.db.machine.deleteMany({
          where: { id: fixture.machine.id },
        });
        await prisma.db.pendingMachineEnrollment.deleteMany({
          where: { id: fixture.enrollment.id },
        });
        await prisma.db.project.deleteMany({
          where: { id: fixture.project.id },
        });
        await prisma.db.organizationMember.deleteMany({
          where: { organizationId: fixture.organization.id },
        });
        await prisma.db.organization.deleteMany({
          where: { id: fixture.organization.id },
        });
        await prisma.db.user.deleteMany({
          where: { id: fixture.user.id },
        });
      }

      if (ids.length > 0) {
        expect(
          await prisma.db.executionAuthorization.count({
            where: { id: { in: ids } },
          }),
        ).toBe(0);
        expect(
          await prisma.db.executionGrant.count({
            where: { authorizationId: { in: ids } },
          }),
        ).toBe(0);
      }
      for (const fixture of currentFixtures) {
        expect(
          await prisma.db.machineControllerCredential.count({
            where: { id: fixture.controller.id },
          }),
        ).toBe(0);
        expect(
          await prisma.db.machine.count({ where: { id: fixture.machine.id } }),
        ).toBe(0);
        expect(
          await prisma.db.pendingMachineEnrollment.count({
            where: { id: fixture.enrollment.id },
          }),
        ).toBe(0);
        expect(
          await prisma.db.agentSession.count({
            where: { id: fixture.session.id },
          }),
        ).toBe(0);
        expect(
          await prisma.db.conversation.count({
            where: { id: fixture.conversation.id },
          }),
        ).toBe(0);
        expect(
          await prisma.db.task.count({ where: { id: fixture.monitor.id } }),
        ).toBe(0);
        expect(
          await prisma.db.project.count({ where: { id: fixture.project.id } }),
        ).toBe(0);
        expect(
          await prisma.db.organization.count({
            where: { id: fixture.organization.id },
          }),
        ).toBe(0);
        expect(
          await prisma.db.user.count({ where: { id: fixture.user.id } }),
        ).toBe(0);
      }

      forbiddenMaterial.splice(0);
    });

    afterAll(async () => {
      logSpy?.mockRestore();
      warnSpy?.mockRestore();
      await prisma.$disconnect();
    });

    const createFixture = async (): Promise<Fixture> => {
      const user = await prisma.db.user.create({
        data: {
          id: randomUUID(),
          email: `controller-auth-${randomUUID()}@example.com`,
          name: 'Controller Authorization Integration User',
          passwordHash: 'integration-test-password-hash',
        },
      });
      const organization = await prisma.db.organization.create({
        data: {
          id: randomUUID(),
          name: `Controller Authorization ${randomUUID()}`,
          slug: `controller-authorization-${randomUUID()}`,
        },
      });
      await prisma.db.organizationMember.create({
        data: { userId: user.id, organizationId: organization.id },
      });
      const project = await prisma.db.project.create({
        data: {
          id: randomUUID(),
          name: 'Controller Authorization Integration Project',
          organizationId: organization.id,
          status: 'ACTIVE',
        },
      });
      const conversation = await prisma.db.conversation.create({
        data: {
          id: randomUUID(),
          organizationId: organization.id,
          projectId: project.id,
          title: 'Controller Authorization Integration Conversation',
          initiatedBy: 'USER',
          status: 'STARTED',
          version: 4,
        },
      });
      const pendingEnrollment = await prisma.db.pendingMachineEnrollment.create(
        {
          data: {
            id: randomUUID(),
            machineId: randomUUID(),
            machinePublicKey: 'machine-public-key-fixture',
            machinePublicKeyFingerprint: 'a'.repeat(64),
            machineName: 'controller-authorization-machine',
            osFamily: 'linux',
            cliVersion: '2.2.2',
            authorizationProtocolVersion: 2,
            userCodeHmac: sha256Hex(`user-code-${randomUUID()}`),
            deviceSecretDigest: sha256Hex(`device-secret-${randomUUID()}`),
            state: 'ACTIVE',
            expiresAt: new Date(Date.now() + 300_000),
            claimantUserId: user.id,
            claimantOrganizationId: organization.id,
            controllerLabel: 'Integration browser controller',
          },
        },
      );
      const machine = await prisma.db.machine.create({
        data: {
          id: pendingEnrollment.machineId,
          userId: user.id,
          organizationId: organization.id,
          name: 'controller-authorization-machine',
          publicKey: 'machine-public-key-fixture',
          tokenHash: sha256Hex(`machine-token-${randomUUID()}`),
          authorizationProtocolVersion: 2,
          authorizationState: 'READY',
        },
      });
      const controller = await prisma.db.machineControllerCredential.create({
        data: {
          id: randomUUID(),
          machineId: machine.id,
          userId: user.id,
          organizationId: organization.id,
          credentialId: `credential-${randomUUID()}`,
          credentialPublicKeyX: publicKeyX,
          credentialPublicKeyY: publicKeyY,
          credentialTransports: ['internal'],
          credentialAaguid: Buffer.alloc(16, 3),
          credentialSignCount: 0,
          credentialBackupEligible: true,
          credentialBackupState: false,
          controllerLabel: 'Integration browser controller',
          credentialFingerprint: sha256Hex(
            publicKeyX.toString('base64') + publicKeyY.toString('base64'),
          ),
          enrollmentId: pendingEnrollment.id,
          controllerInstallationId: pendingEnrollment.id,
        },
      });
      const session = await prisma.db.agentSession.create({
        data: {
          id: randomUUID(),
          organizationId: organization.id,
          userId: user.id,
          projectId: project.id,
          conversationId: conversation.id,
          machineId: machine.id,
          sessionDate: new Date(),
          title: 'Controller Authorization Integration Session',
        },
      });
      const turn = await prisma.db.message.create({
        data: {
          id: randomUUID(),
          conversationId: conversation.id,
          projectId: project.id,
          userId: user.id,
          type: 'USER',
          status: 'OPEN',
          data: { text: 'authorized integration turn' },
        },
      });
      const executionDefinition = {
        executionPlan: [
          {
            taskId: randomUUID(),
            dependsOnTaskIds: [],
            launchConfiguration: {
              provider: 'codex',
              model: 'gpt-5.6',
            },
          },
        ],
        launchPolicy: { terminalSupervision: { mode: 'REQUIRE_REVIEW' } },
      };
      const monitor = await prisma.db.task.create({
        data: {
          id: randomUUID(),
          name: 'Controller Authorization Integration Monitor',
          type: 'TASK_MONITOR',
          organizationId: organization.id,
          projectId: project.id,
          status: 'BACKLOG',
          sections: {
            create: {
              key: 'executionDefinition',
              order: 0,
              materializedMarkdown: JSON.stringify(executionDefinition),
            },
          },
        },
        include: { sections: true },
      });
      const section = monitor.sections[0];
      if (!section)
        throw new Error('Failed to create monitor execution definition');

      const fixture: Fixture = {
        user: { id: user.id },
        organization: { id: organization.id },
        project: { id: project.id },
        conversation: { id: conversation.id, version: conversation.version },
        session: { id: session.id },
        turn: { id: turn.id },
        monitor: {
          id: monitor.id,
          revision: monitor.updatedAt.getTime(),
          sectionId: section.id,
          executionDefinition,
        },
        machine: { id: machine.id },
        controller: {
          id: controller.id,
          credentialId: controller.credentialId,
        },
        enrollment: { id: pendingEnrollment.id },
      };
      fixtures.push(fixture);
      return fixture;
    };

    const makeAction = (
      fixture: Fixture,
      kind: 'interactive' | 'monitor',
    ): HostActionPreparation =>
      kind === 'interactive'
        ? {
            requestId: randomUUID(),
            actionCategory: HostActionCategory.Conversation,
            actionType: HostAffectingActionType.ConversationTrigger,
            targetKind: 'AGENT_SESSION',
            targetId: fixture.session.id,
          }
        : {
            requestId: randomUUID(),
            actionCategory: HostActionCategory.TaskMonitor,
            actionType: HostAffectingActionType.TaskMonitorStart,
            targetKind: 'TASK_MONITOR',
            targetId: fixture.monitor.id,
          };

    const signAssertion = (
      record: AuthorizationFixture,
      intent = record.intent,
    ): any => {
      const clientDataJSON = Buffer.from(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: record.webauthnChallenge,
          origin: 'https://test.heyhey.dev',
        }),
      );
      const authenticatorData = Buffer.alloc(37);
      crypto
        .createHash('sha256')
        .update('test.heyhey.dev')
        .digest()
        .copy(authenticatorData, 0);
      authenticatorData[32] = 0x05;
      authenticatorData.writeUInt32BE(1, 33);
      const signedBytes = Buffer.concat([
        authenticatorData,
        crypto.createHash('sha256').update(clientDataJSON).digest(),
      ]);
      const signature = crypto
        .sign('sha256', signedBytes, keyPair.privateKey)
        .toString('base64url');
      const clientData = clientDataJSON.toString('base64url');
      const authenticator = authenticatorData.toString('base64url');
      forbiddenMaterial.push(
        signature,
        clientData,
        authenticator,
        keyPair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      );
      return {
        kind: 'controller_assertion',
        intent,
        credentialId: record.controllerCredentialId,
        clientDataJSON: clientData,
        authenticatorData: authenticator,
        signature,
        userHandle: Buffer.from(record.userId).toString('base64url'),
      };
    };

    const createAuthorization = async (
      fixture: Fixture,
      action: HostActionPreparation,
      timing: { issuedAt?: Date; expiresAt?: Date } = {},
    ): Promise<AuthorizationFixture> => {
      const id = randomUUID();
      const issuedAt = timing.issuedAt ?? new Date();
      const expiresAt =
        timing.expiresAt ??
        new Date(issuedAt.getTime() + CONTROLLER_AUTHORIZATION_TTL_MS);
      const controllerInstallationId = fixture.enrollment.id;
      expect(fixture.controller.id).not.toBe(fixture.controller.credentialId);
      const cadence = ControllerAuthorizationCadence.FiveMinutes;
      const policyRevision = CONTROLLER_DEVICE_POLICY_REVISION;
      const actionPayloadHash = hashControllerAction(action);
      const allowedActions =
        action.actionCategory === HostActionCategory.Conversation
          ? [
              HostAffectingActionType.ConversationTrigger,
              HostAffectingActionType.CliRead,
              HostAffectingActionType.ApplicationEffectLaunch,
            ]
          : [
              action.actionType,
              HostAffectingActionType.TaskMonitorContinue,
              HostAffectingActionType.TaskMonitorComplete,
            ].filter(
              (candidate, index, all) => all.indexOf(candidate) === index,
            );
      const grantDescriptorHash = hashControllerDeviceGrantDescriptor(
        buildControllerDeviceGrantDescriptor({
          controllerCredentialId: fixture.controller.credentialId,
          controllerInstallationId,
          machineId: fixture.machine.id,
          userId: fixture.user.id,
          organizationId: fixture.organization.id,
          projectId: fixture.project.id,
          action,
          actionPayloadHash,
          target: {
            kind: action.targetKind,
            id: action.targetId,
            revision: null,
            agentSessionId:
              action.targetKind === 'AGENT_SESSION' ? action.targetId : null,
            taskMonitorId:
              action.targetKind === 'TASK_MONITOR' ? action.targetId : null,
          },
          allowedActions,
          cadence,
          policyRevision,
          issuedAt,
        }),
      );
      const intent = {
        version: 2,
        authorizationId: id,
        controllerCredentialId: fixture.controller.credentialId,
        controllerInstallationId,
        machineId: fixture.machine.id,
        userId: fixture.user.id as any,
        organizationId: fixture.organization.id as any,
        projectId: fixture.project.id as any,
        cadence,
        policyRevision,
        effectiveGrantExpiresAtMs: getControllerDeviceGrantExpiry(
          issuedAt,
          cadence,
        ).getTime(),
        grantDescriptorHash,
        actionCategory: action.actionCategory,
        actionType: action.actionType,
        actionPayloadHash,
        allowedActionTypes: [...CURRENT_AGENT_OPERATIONS],
        allowedActionCategories: [...CURRENT_AGENT_OPERATION_CATEGORIES],
        target: {
          kind: action.targetKind,
          id: action.targetId,
          revision: null,
        },
        agentSessionId:
          action.targetKind === 'AGENT_SESSION' ? action.targetId : null,
        taskMonitorId:
          action.targetKind === 'TASK_MONITOR' ? action.targetId : null,
        nonce: crypto.randomBytes(32).toString('base64url'),
        issuedAtMs: issuedAt.getTime(),
        expiresAtMs: expiresAt.getTime(),
      } satisfies CanonicalControllerAuthorizationIntent;
      const canonicalIntent = canonicalizeJcs(intent);
      const webauthnChallenge =
        authorizationService.buildChallenge(canonicalIntent);
      await prisma.db.executionAuthorization.create({
        data: {
          id,
          requestId: action.requestId,
          canonicalIntent,
          webauthnChallenge,
          controllerCredentialId: fixture.controller.id,
          controllerInstallationId,
          machineId: fixture.machine.id,
          userId: fixture.user.id,
          organizationId: fixture.organization.id,
          projectId: fixture.project.id,
          cadence,
          policyRevision,
          grantDescriptorHash,
          actionCategory: action.actionCategory,
          actionType: action.actionType,
          actionPayloadHash: intent.actionPayloadHash,
          targetKind: action.targetKind,
          targetId: action.targetId,
          agentSessionId: intent.agentSessionId,
          taskMonitorId: intent.taskMonitorId,
          nonce: intent.nonce,
          issuedAt,
          expiresAt,
        } as any,
      });
      authorizationIds.push(id);
      const record = {
        id,
        requestId: action.requestId,
        action,
        intent,
        canonicalIntent,
        webauthnChallenge,
        controllerCredentialId: fixture.controller.credentialId,
        userId: fixture.user.id,
        assertion: undefined,
      } as AuthorizationFixture;
      record.assertion = signAssertion(record);
      return record;
    };

    const submit = (
      fixture: Fixture,
      record: AuthorizationFixture,
      overrides: {
        organizationId?: string;
        projectId?: string;
        userId?: string;
        intent?: CanonicalControllerAuthorizationIntent;
      } = {},
    ) =>
      authorizationService.submit({
        organizationId: overrides.organizationId ?? fixture.organization.id,
        projectId: overrides.projectId ?? fixture.project.id,
        userId: overrides.userId ?? fixture.user.id,
        input: {
          authorizationId: record.id,
          assertion: overrides.intent
            ? signAssertion(record, overrides.intent)
            : record.assertion,
        },
      } as any);

    const monitorCommand = (
      fixture: Fixture,
      record: AuthorizationFixture,
      cause: TaskMonitorExternalCommand['cause'] = 'START',
    ): Parameters<ExecutionGrantService['admitTaskMonitorCommand']>[0] => ({
      authorization: record.assertion,
      organizationId: fixture.organization.id as any,
      projectId: fixture.project.id as any,
      userId: fixture.user.id as any,
      controllerBindingSecret: bindingSecretFor(fixture),
      monitorId: fixture.monitor.id as any,
      machineId: fixture.machine.id as any,
      requestId: record.requestId,
      command: {
        cause,
        launchConfig: {
          taskId: randomUUID(),
          method: 'quick',
          provider: 'codex',
          model: 'gpt-5.6',
          reasoningEffort: 'high',
        },
      } as any,
    });

    const expectNoExecutableSideEffects = async (
      fixture: Fixture,
      record: AuthorizationFixture,
    ): Promise<void> => {
      const persisted =
        await prisma.db.executionAuthorization.findUniqueOrThrow({
          where: { id: record.id },
        });
      expect(persisted.consumedAt).toBeNull();
      expect(
        await prisma.db.executionGrant.count({
          where: { authorizationId: record.id },
        }),
      ).toBe(0);
      expect(
        await prisma.db.monitorCommand.count({
          where: {
            organizationId: fixture.organization.id,
            projectId: fixture.project.id,
            monitorId: fixture.monitor.id,
          },
        }),
      ).toBe(0);
    };

    it('admits exactly one concurrent consumer and derives one exact interactive grant', async () => {
      const fixture = await createFixture();
      const record = await createAuthorization(
        fixture,
        makeAction(fixture, 'interactive'),
      );

      const results = await Promise.allSettled([
        submit(fixture, record),
        submit(fixture, record),
      ]);
      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<any> =>
          result.status === 'fulfilled',
      );
      expect(fulfilled).toHaveLength(2);
      expect(
        fulfilled.filter((result) => result.value.outcome === 'ADMITTED'),
      ).toHaveLength(1);
      expect(
        fulfilled.filter(
          (result) =>
            result.value.outcome === 'DENIED' &&
            result.value.reason ===
              ControllerAuthorizationDenialReason.AuthorizationAlreadyConsumed,
        ),
      ).toHaveLength(1);

      const consumed = await prisma.db.executionAuthorization.findUniqueOrThrow(
        {
          where: { id: record.id },
        },
      );
      expect(consumed.outcome).toBe('ADMITTED');
      expect(consumed.consumedAt).not.toBeNull();
      expect(
        await prisma.db.executionGrant.count({
          where: { authorizationId: record.id },
        }),
      ).toBe(0);

      const admission = await grantService.assertInteractiveAuthorized({
        authorization: record.assertion,
        organizationId: fixture.organization.id as any,
        projectId: fixture.project.id as any,
        userId: fixture.user.id as any,
        controllerBindingSecret: bindingSecretFor(fixture),
        machineId: fixture.machine.id as any,
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: 'AGENT_SESSION',
        targetId: fixture.session.id,
        agentSessionId: fixture.session.id as any,
      });
      const [firstGrant, secondGrant] = await Promise.all([
        grantService.deriveInteractiveGrant({
          admission,
          authorizedTurnId: fixture.turn.id as any,
        }),
        grantService.deriveInteractiveGrant({
          admission,
          authorizedTurnId: fixture.turn.id as any,
        }),
      ]);
      expect(firstGrant.grant.id).toBe(secondGrant.grant.id);
      expect(
        await prisma.db.executionGrant.count({
          where: { authorizationId: record.id },
        }),
      ).toBe(1);
      expect(firstGrant.grant).toMatchObject({
        authorizationId: record.id,
        controllerCredentialId: fixture.controller.id,
        machineId: fixture.machine.id,
        userId: fixture.user.id,
        organizationId: fixture.organization.id,
        projectId: fixture.project.id,
        targetKind: 'AGENT_SESSION',
        targetId: fixture.session.id,
        agentSessionId: fixture.session.id,
        authorizedTurnId: fixture.turn.id,
        taskMonitorId: null,
        allowedActions: [
          'CONVERSATION_TRIGGER',
          'CLI_READ',
          'APPLICATION_EFFECT_LAUNCH',
          'CONVERSATION_CONTROL_COMPACT_RUN',
          'CONVERSATION_CONTROL_PERMISSION_DECISION',
        ],
      });

      const retry = await grantService.assertInteractiveAuthorized({
        authorization: {
          kind: 'bounded_grant',
          grantId: firstGrant.grant.id,
        },
        organizationId: fixture.organization.id as any,
        projectId: fixture.project.id as any,
        userId: fixture.user.id as any,
        controllerBindingSecret: bindingSecretFor(fixture),
        machineId: fixture.machine.id as any,
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: 'AGENT_SESSION',
        targetId: fixture.session.id,
        agentSessionId: fixture.session.id as any,
      });
      expect(retry.existingGrantId).toBe(firstGrant.grant.id);
      expect(retry.action).not.toHaveProperty('targetRevision');
      await expect(
        grantService.deriveInteractiveGrant({
          admission: retry,
          authorizedTurnId: randomUUID() as any,
        }),
      ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);

      const row = await prisma.db.executionGrant.findUniqueOrThrow({
        where: { authorizationId: record.id },
      });
      expect(row.targetId).toBe(fixture.session.id);
      expect(row.allowedActions).toEqual([
        'CONVERSATION_TRIGGER',
        'CLI_READ',
        'APPLICATION_EFFECT_LAUNCH',
      ]);
    });

    it('denies expiry and controller revocation transitions that win before consumption', async () => {
      const expiryFixture = await createFixture();
      const expiryIssuedAt = new Date(Date.now() - 119_900);
      const expiryRecord = await createAuthorization(
        expiryFixture,
        makeAction(expiryFixture, 'interactive'),
        { issuedAt: expiryIssuedAt },
      );
      let expirySubmit: Promise<any> | undefined;
      await prisma.db.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT 1 FROM execution_authorizations
          WHERE authorization_id = ${expiryRecord.id}
          FOR UPDATE
        `;
        expirySubmit = submit(expiryFixture, expiryRecord);
        await waitFor(200);
      });
      await expect(expirySubmit).resolves.toMatchObject({
        outcome: 'DENIED',
        reason: ControllerAuthorizationDenialReason.AuthorizationExpired,
      });
      await expectNoExecutableSideEffects(expiryFixture, expiryRecord);

      const revocationFixture = await createFixture();
      const revocationRecord = await createAuthorization(
        revocationFixture,
        makeAction(revocationFixture, 'interactive'),
      );
      let revocationSubmit: Promise<any> | undefined;
      await prisma.db.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT 1 FROM machine_controller_credentials
          WHERE id = ${revocationFixture.controller.id}
          FOR UPDATE
        `;
        revocationSubmit = submit(revocationFixture, revocationRecord);
        await tx.machineControllerCredential.update({
          where: { id: revocationFixture.controller.id },
          data: { revokedAt: new Date() },
        });
      });
      await expect(revocationSubmit).resolves.toMatchObject({
        outcome: 'DENIED',
        reason: ControllerAuthorizationDenialReason.ControllerNotActive,
      });
      await expectNoExecutableSideEffects(revocationFixture, revocationRecord);
    }, 30000);

    it('denies replay and substitutions without executable side effects', async () => {
      const fixture = await createFixture();
      const action = makeAction(fixture, 'interactive');
      const consumed = await createAuthorization(fixture, action);
      await expect(submit(fixture, consumed)).resolves.toMatchObject({
        outcome: 'ADMITTED',
      });
      await expect(submit(fixture, consumed)).resolves.toMatchObject({
        outcome: 'DENIED',
        reason:
          ControllerAuthorizationDenialReason.AuthorizationAlreadyConsumed,
      });

      const substitutions: Array<{
        name: string;
        intent?: (intent: CanonicalControllerAuthorizationIntent) => any;
        context?: {
          organizationId?: string;
          projectId?: string;
          userId?: string;
        };
      }> = [
        {
          name: 'payload hash',
          intent: (intent) => ({
            ...intent,
            actionPayloadHash: '0'.repeat(64),
          }),
        },
        {
          name: 'machine',
          intent: (intent) => ({ ...intent, machineId: randomUUID() }),
        },
        {
          name: 'controller installation',
          intent: (intent) => ({
            ...intent,
            controllerInstallationId: randomUUID(),
          }),
        },
        {
          name: 'cadence',
          intent: (intent) => ({
            ...intent,
            cadence: ControllerAuthorizationCadence.OneMonth,
          }),
        },
        {
          name: 'grant action set',
          intent: (intent) => ({
            ...intent,
            grantDescriptorHash: '0'.repeat(64),
          }),
        },
        {
          name: 'assertion expiry',
          intent: (intent) => ({
            ...intent,
            expiresAtMs: intent.expiresAtMs + 1,
          }),
        },
        {
          name: 'account',
          intent: (intent) => ({ ...intent, userId: randomUUID() }),
          context: { userId: randomUUID() },
        },
        {
          name: 'organization',
          intent: (intent) => ({ ...intent, organizationId: randomUUID() }),
          context: { organizationId: randomUUID() },
        },
        {
          name: 'project',
          intent: (intent) => ({ ...intent, projectId: randomUUID() }),
          context: { projectId: randomUUID() },
        },
        {
          name: 'target',
          intent: (intent) => ({
            ...intent,
            target: { ...intent.target, id: randomUUID() },
          }),
        },
        {
          name: 'agent session',
          intent: (intent) => ({
            ...intent,
            agentSessionId: fixture.session.id,
          }),
        },
        {
          name: 'revision',
          intent: (intent) => ({
            ...intent,
            target: { ...intent.target, revision: 5 },
          }),
        },
      ];

      for (const substitution of substitutions) {
        const candidate = await createAuthorization(fixture, action);
        const result = await submit(fixture, candidate, {
          ...substitution.context,
          intent: substitution.intent?.(candidate.intent),
        });
        expect(result).toMatchObject({ outcome: 'DENIED' });
        await expectNoExecutableSideEffects(fixture, candidate);
      }

      const monitorAction = makeAction(fixture, 'monitor');
      const monitorCandidate = await createAuthorization(
        fixture,
        monitorAction,
      );
      const monitorResult = await submit(fixture, monitorCandidate, {
        intent: {
          ...monitorCandidate.intent,
          taskMonitorId: randomUUID(),
        },
      });
      expect(monitorResult).toMatchObject({ outcome: 'DENIED' });
      await expectNoExecutableSideEffects(fixture, monitorCandidate);
    });

    it('keeps Task Monitor selection, policy, action, retry, and reductions bounded', async () => {
      const fixture = await createFixture();
      const record = await createAuthorization(
        fixture,
        makeAction(fixture, 'monitor'),
      );
      await expect(submit(fixture, record)).resolves.toMatchObject({
        outcome: 'ADMITTED',
      });
      const params = monitorCommand(fixture, record);
      const admitted = await grantService.admitTaskMonitorCommand(params);
      const baseline = admitted.grant;
      expect(baseline).toMatchObject({
        authorizationId: record.id,
        controllerCredentialId: fixture.controller.id,
        machineId: fixture.machine.id,
        userId: fixture.user.id,
        organizationId: fixture.organization.id,
        projectId: fixture.project.id,
        targetKind: 'TASK_MONITOR',
        targetId: fixture.monitor.id,
        taskMonitorId: fixture.monitor.id,
        allowedActions: [
          'TASK_MONITOR_START',
          'TASK_MONITOR_CONTINUE',
          'TASK_MONITOR_COMPLETE',
        ],
      });
      expect(baseline.selectedWorkFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(baseline.policyFingerprint).toMatch(/^[0-9a-f]{64}$/);

      const originalDefinition = fixture.monitor.executionDefinition;
      const selectedWork = originalDefinition.executionPlan.map(
        (entry: Record<string, unknown>) => ({
          taskId: entry.taskId,
          dependsOnTaskIds: entry.dependsOnTaskIds,
        }),
      );
      const executionPolicy = {
        launchPolicy: originalDefinition.launchPolicy,
        nodeLaunchConfigurations: originalDefinition.executionPlan.map(
          (entry: Record<string, unknown>) => entry.launchConfiguration,
        ),
      };
      expect(baseline.selectedWorkFingerprint).toBe(
        sha256Hex(canonicalizeJcs(selectedWork)),
      );
      expect(baseline.policyFingerprint).toBe(
        sha256Hex(canonicalizeJcs(executionPolicy)),
      );
      await prisma.db.taskSection.update({
        where: { id: fixture.monitor.sectionId },
        data: {
          materializedMarkdown: JSON.stringify({
            ...originalDefinition,
            executionPlan: [
              {
                ...originalDefinition.executionPlan[0],
                taskId: randomUUID(),
              },
            ],
          }),
        },
      });
      await expect(
        grantService.admitTaskMonitorCommand(params),
      ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);

      await prisma.db.taskSection.update({
        where: { id: fixture.monitor.sectionId },
        data: {
          materializedMarkdown: JSON.stringify({
            ...originalDefinition,
            launchPolicy: { terminalSupervision: { mode: 'ALLOW' } },
          }),
        },
      });
      await expect(
        grantService.admitTaskMonitorCommand(params),
      ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);

      await prisma.db.taskSection.update({
        where: { id: fixture.monitor.sectionId },
        data: { materializedMarkdown: JSON.stringify(originalDefinition) },
      });
      await expect(
        grantService.admitTaskMonitorCommand(
          monitorCommand(fixture, record, 'RESUME'),
        ),
      ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);

      await prisma.db.task.update({
        where: { id: fixture.monitor.id },
        data: { name: 'Controller Authorization Revision Substitution' },
      });
      await expect(
        grantService.admitTaskMonitorCommand(params),
      ).rejects.toBeInstanceOf(ExecutionGrantAdmissionDeniedException);

      await grantService.reduceTaskMonitorAuthority({
        organizationId: fixture.organization.id as any,
        projectId: fixture.project.id as any,
        userId: fixture.user.id as any,
        monitorId: fixture.monitor.id as any,
        command: { cause: 'PAUSE' },
      });
      const reduced = await prisma.db.executionGrant.findUniqueOrThrow({
        where: { authorizationId: record.id },
      });
      expect(reduced.id).toBe(baseline.id);
      expect(reduced.suspendedAt).not.toBeNull();
      expect(reduced.terminalAt).toBeNull();
      expect(
        await prisma.db.executionAuthorization.findUniqueOrThrow({
          where: { id: record.id },
        }),
      ).toMatchObject({ outcome: 'ADMITTED' });
      expect(
        await prisma.db.monitorCommand.count({
          where: {
            organizationId: fixture.organization.id,
            projectId: fixture.project.id,
            monitorId: fixture.monitor.id,
          },
        }),
      ).toBe(0);
    });

    it('keeps persisted rows and captured logs free of raw assertion and private material', async () => {
      const fixture = await createFixture();
      const record = await createAuthorization(
        fixture,
        makeAction(fixture, 'interactive'),
      );
      await expect(submit(fixture, record)).resolves.toMatchObject({
        outcome: 'ADMITTED',
      });
      const logs = JSON.stringify({
        log: logSpy.mock.calls,
        warn: warnSpy.mock.calls,
      });
      const rows = await prisma.db.executionAuthorization.findMany({
        where: { id: { in: authorizationIds } },
        select: {
          canonicalIntent: true,
          webauthnChallenge: true,
          actionPayloadHash: true,
          nonce: true,
        },
      });
      const persisted = JSON.stringify(rows);
      for (const material of forbiddenMaterial) {
        expect(persisted).not.toContain(material);
        expect(logs).not.toContain(material);
      }
      expect(persisted).not.toContain('launchConfiguration');
      expect(persisted).not.toContain('privateKey');
      expect(logs).not.toContain('clientDataJSON');
      expect(logs).not.toContain('authenticatorData');
      expect(logs).not.toContain('signature');
    });
  },
);
