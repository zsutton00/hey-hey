import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Integration coverage for authenticated conversation reads with explicit
 * Message-owned Proposal and Report associations.
 *
 * Boots the full Nest app, seeds an organization/project/conversation and an
 * intentionally ambiguous historical interaction, then issues authenticated
 * conversation reads with Messages, Proposals, and Reports included. The
 * carrier-owned records must remain attached to their original Message.
 */
describe('GET /conversations/:id — historical carrier associations', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let module: TestingModule;
  let authToken: string;
  let testOrganizationId: string;
  let testProjectId: string;
  let testConversationId: string;
  let testUserMessageId: string;
  let testCarrierMessageId: string;
  let testNarrationMessageId: string;
  let testCompletionMessageId: string;
  let testProposalId: string;
  let testReportId: string;
  let testInternalReportId: string;

  const testUser = {
    email: 'include-reports-test@example.com',
    password: 'SecurePassword123!',
    name: 'Include Reports Test User',
    organizationName: 'Include Reports Test Organization',
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    prisma = module.get<PrismaService>(PrismaService);

    await app.init();
    await setupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
    await module.close();
  });

  it('preserves unresolved carrier associations across repeated authenticated reads', async () => {
    const readConversation = async () =>
      request(app.getHttpServer())
        .get(
          `/api/v1/organizations/${testOrganizationId}/projects/${testProjectId}/conversations/${testConversationId}`,
        )
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          includeMessages: 'true',
          includeProposals: 'true',
          includeReports: 'true',
        })
        .expect(200);

    const firstConversation = (await readConversation()).body;
    expect(firstConversation.id).toBe(testConversationId);
    expect(
      firstConversation.messages.map((message: { id: string }) => message.id),
    ).toEqual([
      testUserMessageId,
      testCarrierMessageId,
      testNarrationMessageId,
      testCompletionMessageId,
    ]);

    const firstCarrier = firstConversation.messages[1];
    expect(firstCarrier).toMatchObject({
      id: testCarrierMessageId,
      type: 'SYSTEM',
      data: { type: 'CARRIER' },
    });
    expect(firstConversation.messages[2]).toMatchObject({
      id: testNarrationMessageId,
      type: 'SYSTEM',
      data: { type: 'AGENT', response: 'Historical narration' },
    });
    expect(firstConversation.messages[3]).toMatchObject({
      id: testCompletionMessageId,
      type: 'SYSTEM',
      data: {
        type: 'AGENT',
        actionHint: 'task_complete',
        response: 'Historical completion',
      },
    });
    expect(
      firstCarrier.proposals.map((proposal: { id: string }) => proposal.id),
    ).toEqual([testProposalId]);
    // Only the user-facing report should be rendered inline. The
    // WORKFLOW_ONLY report linked to the same carrier must be filtered out by
    // the shared loader's audience allow-list.
    expect(
      firstCarrier.reports.map((report: { id: string }) => report.id),
    ).toEqual([testReportId]);
    expect(firstCarrier.reports[0]).toMatchObject({
      id: testReportId,
      audience: 'PROJECT_VISIBLE',
      entities: expect.arrayContaining([
        expect.objectContaining({
          entityType: 'MESSAGE',
          entityId: testCarrierMessageId,
          relation: 'CONTEXT',
        }),
      ]),
    });
    expect(
      firstCarrier.reports.some(
        (report: { id: string }) => report.id === testInternalReportId,
      ),
    ).toBe(false);

    for (const message of firstConversation.messages.filter(
      (candidate: { id: string }) => candidate.id !== testCarrierMessageId,
    )) {
      expect(message.proposals).toEqual([]);
      expect(message.reports).toEqual([]);
    }

    const secondConversation = (await readConversation()).body;
    expect(
      secondConversation.messages.map((message: { id: string }) => message.id),
    ).toEqual(
      firstConversation.messages.map((message: { id: string }) => message.id),
    );
    const secondCarrier = secondConversation.messages[1];
    expect(
      secondCarrier.proposals.map((proposal: { id: string }) => proposal.id),
    ).toEqual([testProposalId]);
    expect(
      secondCarrier.reports.map((report: { id: string }) => report.id),
    ).toEqual([testReportId]);
  });

  it('omits the reports field (or returns it empty) when includeReports is absent', async () => {
    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/organizations/${testOrganizationId}/projects/${testProjectId}/conversations/${testConversationId}`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .query({ includeMessages: 'true' })
      .expect(200);

    const message = response.body.messages.find(
      (candidate: { id: string }) => candidate.id === testCarrierMessageId,
    );
    // The flag is opt-in (default false). We don't run the loader, so the dto
    // should not carry a reports[] array (or, if it does, it should be empty).
    expect(message.reports === undefined || message.reports.length === 0).toBe(
      true,
    );
  });

  async function setupTestData() {
    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(testUser);

    authToken = registerResponse.body.accessToken;

    const user = await prisma.db.user.findUnique({
      where: { email: testUser.email },
      include: { memberships: { include: { organization: true } } },
    });
    if (!user) throw new Error('Failed to create test user');
    testOrganizationId = user.memberships[0]!.organizationId;

    const project = await prisma.db.project.create({
      data: {
        name: 'IncludeReports Integration Project',
        description: 'Project for includeReports integration tests',
        organizationId: testOrganizationId,
        status: 'ACTIVE',
      },
    });
    testProjectId = project.id;

    const conversation = await prisma.db.conversation.create({
      data: {
        title: 'IncludeReports Integration Conversation',
        workflowName: 'support',
        status: 'STARTED',
        projectId: testProjectId,
        organizationId: testOrganizationId,
        workflowId: `test-workflow-${Date.now()}`,
        initiatedBy: 'USER',
        triggerEvent: 'test_trigger',
      },
    });
    testConversationId = conversation.id;

    await prisma.db.projectMember.create({
      data: {
        projectId: testProjectId,
        userId: user.id,
        role: 'OWNER',
      },
    });

    const baseMessageTime = new Date('2026-08-30T00:00:00.000Z');
    const userMessage = await prisma.db.message.create({
      data: {
        type: 'USER',
        status: 'OPEN',
        userId: user.id,
        projectId: testProjectId,
        conversationId: testConversationId,
        data: { text: 'Historical interaction' },
        createdAt: new Date(baseMessageTime.getTime() + 1000),
      },
    });
    testUserMessageId = userMessage.id;

    const carrierMessage = await prisma.db.message.create({
      data: {
        type: 'SYSTEM',
        status: 'completed',
        userId: 'system',
        projectId: testProjectId,
        conversationId: testConversationId,
        data: { type: 'CARRIER' },
        createdAt: new Date(baseMessageTime.getTime() + 2000),
      },
    });
    testCarrierMessageId = carrierMessage.id;

    const narrationMessage = await prisma.db.message.create({
      data: {
        type: 'SYSTEM',
        status: 'completed',
        userId: 'system',
        projectId: testProjectId,
        conversationId: testConversationId,
        data: { type: 'AGENT', response: 'Historical narration' },
        createdAt: new Date(baseMessageTime.getTime() + 3000),
      },
    });
    testNarrationMessageId = narrationMessage.id;

    const completionMessage = await prisma.db.message.create({
      data: {
        type: 'SYSTEM',
        status: 'completed',
        userId: 'system',
        projectId: testProjectId,
        conversationId: testConversationId,
        data: {
          type: 'AGENT',
          actionHint: 'task_complete',
          response: 'Historical completion',
        },
        createdAt: new Date(baseMessageTime.getTime() + 4000),
      },
    });
    testCompletionMessageId = completionMessage.id;

    const proposal = await prisma.db.proposal.create({
      data: {
        organizationId: testOrganizationId,
        projectId: testProjectId,
        type: 'SINGLE',
        action: 'UPDATE',
        status: 'DRAFT',
        targetEntityId: testConversationId,
        targetEntityType: 'CONVERSATION',
        updates: { title: 'Historical proposal' },
        requestorId: user.id,
        requestorContext: { source: 'agent' },
        conversationId: testConversationId,
        messageId: testCarrierMessageId,
        createdAt: new Date(baseMessageTime.getTime() + 5000),
      },
    });
    testProposalId = proposal.id;

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const report = await prisma.db.report.create({
      data: {
        organizationId: testOrganizationId,
        projectId: testProjectId,
        reportType: 'SESSION_SUMMARY',
        audience: 'PROJECT_VISIBLE',
        payload: {
          reportType: 'SESSION_SUMMARY',
          text: 'A short summary of the session.',
        },
        schemaVersion: 1,
        expiresAt,
        reportEntities: {
          create: [
            {
              entityType: 'MESSAGE',
              entityId: testCarrierMessageId,
              relation: 'CONTEXT',
            },
          ],
        },
      },
    });
    testReportId = report.id;

    const internalReport = await prisma.db.report.create({
      data: {
        organizationId: testOrganizationId,
        projectId: testProjectId,
        reportType: 'SESSION_SUMMARY',
        audience: 'WORKFLOW_ONLY',
        payload: {
          reportType: 'SESSION_SUMMARY',
          text: 'Internal-only summary that must not leak into the response.',
        },
        schemaVersion: 1,
        expiresAt,
        reportEntities: {
          create: [
            {
              entityType: 'MESSAGE',
              entityId: testCarrierMessageId,
              relation: 'CONTEXT',
            },
          ],
        },
      },
    });
    testInternalReportId = internalReport.id;
  }

  async function cleanupTestData() {
    try {
      await prisma.db.report.deleteMany({
        where: { organizationId: testOrganizationId },
      });
      await prisma.db.proposal.deleteMany({
        where: { organizationId: testOrganizationId },
      });
      await prisma.db.message.deleteMany({
        where: { conversationId: testConversationId },
      });
      await prisma.db.conversation.deleteMany({
        where: { id: testConversationId },
      });
      await prisma.db.project.deleteMany({
        where: { id: testProjectId },
      });
      await prisma.db.organization.deleteMany({
        where: { name: testUser.organizationName },
      });
    } catch (error) {
      console.error('Failed to clean up include-reports test data', error);
    }
  }
});
