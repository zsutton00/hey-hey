import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentSessionService } from '../agent-session.service';

const describeDatabase =
  process.env.RUN_AGENT_SESSION_DELETION_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

type Fixture = {
  userId: string;
  organizationId: string;
  projectId: string;
  machineId: string;
  enrollmentId: string;
  controllerCredentialId: string;
  supportConversationId: string;
  authorizedTurnId: string;
  sessionIds: string[];
  operationIds: string[];
  authorizationIds: string[];
  grantIds: string[];
  operationMessageIds: string[];
};

describeDatabase('AgentSessionService deletion PostgreSQL invariants', () => {
  let prisma: PrismaService;
  let service: AgentSessionService;
  const fixtures: Fixture[] = [];
  const deletedEventSessionIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new AgentSessionService(
      prisma,
      {
        publishInTransaction: jest.fn(
          async (_tx: unknown, event: { aggregateId: string }) => {
            deletedEventSessionIds.push(event.aggregateId);
            return null;
          },
        ),
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(async () => {
    deletedEventSessionIds.splice(0);

    for (const fixture of fixtures.splice(0)) {
      await prisma.db.message.deleteMany({
        where: { id: { in: fixture.operationMessageIds } },
      });
      await prisma.db.agentOperation.deleteMany({
        where: { operationId: { in: fixture.operationIds } },
      });
      await prisma.db.executionGrant.deleteMany({
        where: { id: { in: fixture.grantIds } },
      });
      await prisma.db.executionAuthorization.deleteMany({
        where: { id: { in: fixture.authorizationIds } },
      });
      await prisma.db.message.deleteMany({
        where: { id: fixture.authorizedTurnId },
      });
      await prisma.db.conversation.deleteMany({
        where: { id: fixture.supportConversationId },
      });
      await prisma.db.agentSession.deleteMany({
        where: { id: { in: fixture.sessionIds } },
      });
      await prisma.db.machineControllerCredential.deleteMany({
        where: { id: fixture.controllerCredentialId },
      });
      await prisma.db.machine.deleteMany({
        where: { id: fixture.machineId },
      });
      await prisma.db.pendingMachineEnrollment.deleteMany({
        where: { id: fixture.enrollmentId },
      });
      await prisma.db.project.deleteMany({
        where: { id: fixture.projectId },
      });
      await prisma.db.organizationMember.deleteMany({
        where: { organizationId: fixture.organizationId },
      });
      await prisma.db.organization.deleteMany({
        where: { id: fixture.organizationId },
      });
      await prisma.db.user.deleteMany({
        where: { id: fixture.userId },
      });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const createFixture = async (): Promise<Fixture> => {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const projectId = randomUUID();
    const machineId = randomUUID();
    const enrollmentId = randomUUID();
    const controllerCredentialId = randomUUID();
    const supportConversationId = randomUUID();
    const authorizedTurnId = randomUUID();

    await prisma.db.user.create({
      data: {
        id: userId,
        email: `agent-session-delete-${randomUUID()}@example.com`,
        name: 'Agent Session Deletion Integration User',
        passwordHash: 'integration-test-password-hash',
      },
    });
    await prisma.db.organization.create({
      data: {
        id: organizationId,
        name: `Agent Session Deletion ${randomUUID()}`,
        slug: `agent-session-deletion-${randomUUID()}`,
      },
    });
    await prisma.db.organizationMember.create({
      data: { userId, organizationId },
    });
    await prisma.db.project.create({
      data: {
        id: projectId,
        name: 'Agent Session Deletion Integration Project',
        organizationId,
        status: 'ACTIVE',
      },
    });
    await prisma.db.pendingMachineEnrollment.create({
      data: {
        id: enrollmentId,
        machineId,
        machinePublicKey: 'agent-session-deletion-machine-key',
        machinePublicKeyFingerprint: randomBytes(32).toString('hex'),
        machineName: 'agent-session-deletion-machine',
        osFamily: 'linux',
        cliVersion: '2.2.2',
        authorizationProtocolVersion: 2,
        userCodeHmac: randomBytes(32).toString('hex'),
        deviceSecretDigest: randomBytes(32).toString('hex'),
        state: 'ACTIVE',
        expiresAt: new Date(Date.now() + 300_000),
        claimantUserId: userId,
        claimantOrganizationId: organizationId,
        controllerLabel: 'Agent Session Deletion Integration Controller',
      },
    });
    await prisma.db.machine.create({
      data: {
        id: machineId,
        userId,
        organizationId,
        name: 'agent-session-deletion-machine',
        publicKey: 'agent-session-deletion-machine-key',
        tokenHash: randomBytes(32).toString('hex'),
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
      },
    });
    await prisma.db.machineControllerCredential.create({
      data: {
        id: controllerCredentialId,
        machineId,
        userId,
        organizationId,
        credentialId: `agent-session-deletion-credential-${randomUUID()}`,
        credentialPublicKeyX: Buffer.alloc(32, 1),
        credentialPublicKeyY: Buffer.alloc(32, 2),
        credentialTransports: ['internal'],
        credentialAaguid: Buffer.alloc(16, 3),
        credentialSignCount: 0,
        credentialBackupEligible: true,
        credentialBackupState: false,
        controllerLabel: 'Agent Session Deletion Integration Controller',
        credentialFingerprint: randomBytes(32).toString('hex'),
        enrollmentId,
      },
    });
    await prisma.db.conversation.create({
      data: {
        id: supportConversationId,
        organizationId,
        projectId,
        title: 'Agent Session Deletion Support Conversation',
        initiatedBy: 'USER',
        status: 'STARTED',
        version: 1,
      },
    });
    await prisma.db.message.create({
      data: {
        id: authorizedTurnId,
        conversationId: supportConversationId,
        projectId,
        userId,
        type: 'USER',
        status: 'OPEN',
        data: { text: 'agent session deletion grant turn' },
      },
    });

    const fixture: Fixture = {
      userId,
      organizationId,
      projectId,
      machineId,
      enrollmentId,
      controllerCredentialId,
      supportConversationId,
      authorizedTurnId,
      sessionIds: [],
      operationIds: [],
      authorizationIds: [],
      grantIds: [],
      operationMessageIds: [],
    };
    fixtures.push(fixture);
    return fixture;
  };

  const createSession = async (fixture: Fixture): Promise<string> => {
    const id = randomUUID();
    await prisma.db.agentSession.create({
      data: {
        id,
        organizationId: fixture.organizationId,
        userId: fixture.userId,
        projectId: fixture.projectId,
        conversationId: fixture.supportConversationId,
        sessionDate: new Date(),
        title: 'Agent Session Deletion Integration Session',
      },
    });
    fixture.sessionIds.push(id);
    return id;
  };

  const createAuthorization = async (
    fixture: Fixture,
    agentSessionId: string,
  ): Promise<string> => {
    const id = randomUUID();
    const issuedAt = new Date();
    const authorization = await prisma.db.executionAuthorization.create({
      data: {
        id,
        requestId: randomUUID(),
        canonicalIntent: '{}',
        webauthnChallenge: randomBytes(32).toString('base64url'),
        controllerCredentialId: fixture.controllerCredentialId,
        controllerInstallationId: fixture.enrollmentId,
        machineId: fixture.machineId,
        userId: fixture.userId,
        organizationId: fixture.organizationId,
        projectId: fixture.projectId,
        cadence: 'ONE_DAY',
        policyRevision: 1,
        grantDescriptorHash: 'a'.repeat(64),
        actionCategory: 'CONVERSATION',
        actionType: 'CONVERSATION_TRIGGER',
        actionPayloadHash: 'b'.repeat(64),
        targetKind: 'AGENT_SESSION',
        targetId: agentSessionId,
        agentSessionId,
        taskMonitorId: null,
        nonce: randomBytes(32).toString('base64url'),
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 120_000),
      } as any,
    });
    fixture.authorizationIds.push(authorization.id);
    return authorization.id;
  };

  const createGrant = async (
    fixture: Fixture,
    authorizationId: string,
    agentSessionId: string,
  ): Promise<string> => {
    const id = randomUUID();
    const issuedAt = new Date();
    const grant = await prisma.db.executionGrant.create({
      data: {
        id,
        authorizationId,
        scope: 'INTERACTIVE_TURN',
        controllerCredentialId: fixture.controllerCredentialId,
        controllerInstallationId: fixture.enrollmentId,
        machineId: fixture.machineId,
        userId: fixture.userId,
        organizationId: fixture.organizationId,
        projectId: fixture.projectId,
        cadence: 'ONE_DAY',
        policyRevision: 1,
        grantDescriptorHash: 'c'.repeat(64),
        targetKind: 'AGENT_SESSION',
        targetId: agentSessionId,
        allowedActions: ['CONVERSATION_TRIGGER'],
        agentSessionId,
        authorizedTurnId: fixture.authorizedTurnId,
        taskMonitorId: null,
        selectedWorkFingerprint: null,
        policyFingerprint: null,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 120_000),
        suspendedAt: null,
        terminalAt: null,
        revokedAt: null,
      } as any,
    });
    fixture.grantIds.push(grant.id);
    return grant.id;
  };

  const createOperation = async (
    fixture: Fixture,
    agentSessionId: string,
    grantId: string,
  ): Promise<string> => {
    const operationId = randomUUID();
    await prisma.db.agentOperation.create({
      data: {
        operationId,
        organizationId: fixture.organizationId,
        projectId: fixture.projectId,
        userId: fixture.userId,
        agentSessionId,
        conversationId: fixture.supportConversationId,
        kind: 'START_RUN',
        fingerprint: 'd'.repeat(64),
        grantId,
      },
    });
    fixture.operationIds.push(operationId);
    return operationId;
  };

  const createOperationMessage = async (
    fixture: Fixture,
    operationId: string,
  ): Promise<string> => {
    const id = randomUUID();
    await prisma.db.message.create({
      data: {
        id,
        conversationId: fixture.supportConversationId,
        projectId: fixture.projectId,
        userId: fixture.userId,
        type: 'USER',
        data: { text: 'agent session deletion operation message' },
        executionOperationId: operationId,
      },
    });
    fixture.operationMessageIds.push(id);
    return id;
  };

  it('rolls back an eval launch without retaining sessions, conversations or messages', async () => {
    const fixture = await createFixture();
    const sessionId = await createSession(fixture);
    await prisma.db.agentSession.update({
      where: { id: sessionId },
      data: { status: 'NOT_STARTED' },
    });

    await service.rollbackEvalLaunchSession(
      fixture.organizationId as never,
      sessionId,
    );

    expect(
      await prisma.db.agentSession.count({ where: { id: sessionId } }),
    ).toBe(0);
    expect(
      await prisma.db.conversation.count({
        where: { id: fixture.supportConversationId },
      }),
    ).toBe(0);
    expect(
      await prisma.db.message.count({
        where: { conversationId: fixture.supportConversationId },
      }),
    ).toBe(0);
  });

  it('deletes a session with no authority rows', async () => {
    const fixture = await createFixture();
    const sessionId = await createSession(fixture);

    await service.remove(fixture.organizationId as any, sessionId);

    expect(
      await prisma.db.agentSession.count({ where: { id: sessionId } }),
    ).toBe(0);
    expect(deletedEventSessionIds).toEqual([sessionId]);
  });

  it('deletes a session with an authorization but no grant', async () => {
    const fixture = await createFixture();
    const sessionId = await createSession(fixture);
    const authorizationId = await createAuthorization(fixture, sessionId);

    await service.remove(fixture.organizationId as any, sessionId);

    expect(
      await prisma.db.agentSession.count({ where: { id: sessionId } }),
    ).toBe(0);
    expect(
      await prisma.db.executionAuthorization.count({
        where: { id: authorizationId },
      }),
    ).toBe(0);
    expect(deletedEventSessionIds).toEqual([sessionId]);
  });

  it('deletes an operation-linked message and preserves another session', async () => {
    const fixture = await createFixture();
    const sessionId = await createSession(fixture);
    const unrelatedSessionId = await createSession(fixture);
    const authorizationId = await createAuthorization(fixture, sessionId);
    const unrelatedAuthorizationId = await createAuthorization(
      fixture,
      unrelatedSessionId,
    );
    const grantId = await createGrant(fixture, authorizationId, sessionId);
    const operationId = await createOperation(fixture, sessionId, grantId);
    const operationMessageId = await createOperationMessage(
      fixture,
      operationId,
    );
    const unrelatedGrantId = await createGrant(
      fixture,
      unrelatedAuthorizationId,
      unrelatedSessionId,
    );
    const unrelatedOperationId = await createOperation(
      fixture,
      unrelatedSessionId,
      unrelatedGrantId,
    );
    const unrelatedOperationMessageId = await createOperationMessage(
      fixture,
      unrelatedOperationId,
    );

    await service.remove(fixture.organizationId as any, sessionId);

    expect(
      await prisma.db.executionGrant.count({ where: { id: grantId } }),
    ).toBe(0);
    expect(
      await prisma.db.agentOperation.count({ where: { operationId } }),
    ).toBe(0);
    expect(
      await prisma.db.message.findUnique({
        where: { id: operationMessageId },
      }),
    ).toMatchObject({ executionOperationId: null });
    expect(
      await prisma.db.agentOperation.count({
        where: { operationId: unrelatedOperationId },
      }),
    ).toBe(1);
    expect(
      await prisma.db.message.findUnique({
        where: { id: unrelatedOperationMessageId },
      }),
    ).toMatchObject({ executionOperationId: unrelatedOperationId });
    expect(
      await prisma.db.executionAuthorization.count({
        where: { id: authorizationId },
      }),
    ).toBe(0);
    expect(
      await prisma.db.executionGrant.count({
        where: { id: unrelatedGrantId },
      }),
    ).toBe(1);
    expect(
      await prisma.db.executionAuthorization.count({
        where: { id: unrelatedAuthorizationId },
      }),
    ).toBe(1);
    expect(
      await prisma.db.agentSession.count({
        where: { id: unrelatedSessionId },
      }),
    ).toBe(1);
    expect(deletedEventSessionIds).toEqual([sessionId]);
  });
});
