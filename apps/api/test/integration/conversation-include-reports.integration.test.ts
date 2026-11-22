import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import * as request from 'supertest';
import { ProjectAccessService } from '../../src/auth/services/project-access.service';
import { MessageController } from '../../src/controllers/message.controller';
import { DomainEventPublisher } from '../../src/core/events/domain-event-publisher';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EntityRegistryService } from '../../src/services/entity-registry/entity-registry.service';
import { MessageService } from '../../src/services/message.service';
import { ORDINARY_PROPOSAL_VISIBILITY_WHERE } from '../../src/services/proposal/proposal-visibility';
import { ReportService } from '../../src/services/reports/report.service';
import { createServiceTestingModule } from '../setup/testing-module.factory';

describe('Project Message reads and historical carrier associations', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let readerId: string;
  let peerId: string;
  let testOrganizationId: string;
  let testProjectId: string;
  let otherProjectId: string;
  let otherConversationId: string;
  let otherMessageId: string;
  let testConversationId: string;
  let testUserMessageId: string;
  let testCarrierMessageId: string;
  let testNarrationMessageId: string;
  let testCompletionMessageId: string;
  let testProposalId: string;
  let testReportId: string;
  let testInternalReportId: string;

  const fixtureId = randomUUID();
  const fixtureEmail = (role: string) =>
    `message-reads-${role}-${fixtureId}@example.com`;

  beforeAll(async () => {
    const { module } = await createServiceTestingModule({
      controllers: [MessageController],
      providers: [
        PrismaService,
        ProjectAccessService,
        MessageService,
        ReportService,
        EntityRegistryService,
        { provide: DomainEventPublisher, useValue: {} },
      ],
    });

    app = module.createNestApplication();
    prisma = module.get(PrismaService);
    // Supply the authenticated identity at the HTTP boundary. The real
    // organization and project guards still authorize each request.
    app.use((req: Request, _res: unknown, next: () => void) => {
      const userId =
        req.headers['x-test-reader'] === 'peer' ? peerId : readerId;
      Object.assign(req, { user: { userId } });
      next();
    });
    await app.init();
    await setupTestData();
  });

  afterAll(async () => {
    try {
      await cleanupTestData();
    } finally {
      await app?.close();
    }
  });

  const messageIds = (messages: Array<{ id: string }>) =>
    messages.map((message) => message.id);

  const readMessages = (messageId?: string, reader = 'creator') =>
    request(app.getHttpServer())
      .get(
        `/api/v1/organizations/${testOrganizationId}/projects/${testProjectId}/messages${messageId ? `/${messageId}` : ''}`,
      )
      .set('x-test-reader', reader);

  const threadIds = () => [
    testUserMessageId,
    testCarrierMessageId,
    testNarrationMessageId,
    testCompletionMessageId,
  ];

  it('uses the authorized project for list and individual reads', async () => {
    const omitted = await readMessages().expect(200);
    const conflicting = await readMessages()
      .query({ projectId: otherProjectId })
      .expect(200);
    expect(messageIds(omitted.body)).toEqual(threadIds());
    expect(messageIds(conflicting.body)).toEqual(threadIds());

    const local = await readMessages(testUserMessageId).expect(200);
    expect(local.body.id).toBe(testUserMessageId);
    await readMessages(otherMessageId).expect(404);
  });

  it('preserves ordered full threads and cursor deltas with carrier associations', async () => {
    const readThread = (since?: string) =>
      readMessages().query({
        conversationId: testConversationId,
        includeProposals: 'true',
        includeReports: 'true',
        ...(since && { since }),
      });

    const { body: messages } = await readThread().expect(200);
    expect(messageIds(messages)).toEqual(threadIds());

    expect(
      await prisma.db.messageProposalReference.count({
        where: {
          messageId: testCarrierMessageId,
          proposal: ORDINARY_PROPOSAL_VISIBILITY_WHERE,
        },
      }),
    ).toBe(1);
    const firstCarrier = messages[1];
    expect(firstCarrier).toMatchObject({
      id: testCarrierMessageId,
      type: 'SYSTEM',
      data: { type: 'CARRIER' },
    });
    expect(messages[2]).toMatchObject({
      id: testNarrationMessageId,
      type: 'SYSTEM',
      data: { type: 'AGENT', response: 'Historical narration' },
    });
    expect(messages[3]).toMatchObject({
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

    for (const message of messages.filter(
      (candidate: { id: string }) => candidate.id !== testCarrierMessageId,
    )) {
      expect(message.proposals).toEqual([]);
      expect(message.reports).toEqual([]);
    }

    const { body: delta } = await readThread(testUserMessageId).expect(200);
    expect(messageIds(delta)).toEqual(threadIds().slice(1));
    expect(messageIds(delta[0].proposals)).toEqual([testProposalId]);
    expect(messageIds(delta[0].reports)).toEqual([testReportId]);
    await readThread(otherMessageId).expect(404);
  });

  it('omits the reports field (or returns it empty) when includeReports is absent', async () => {
    const response = await readMessages()
      .query({ conversationId: testConversationId })
      .expect(200);

    const message = response.body.find(
      (candidate: { id: string }) => candidate.id === testCarrierMessageId,
    );
    // The flag is opt-in (default false). We don't run the loader, so the dto
    // should not carry a reports[] array (or, if it does, it should be empty).
    expect(message.reports === undefined || message.reports.length === 0).toBe(
      true,
    );
  });

  it('keeps a restricted thread readable only by its creator', async () => {
    await readMessages(undefined, 'peer')
      .query({ conversationId: testConversationId })
      .expect(403);
    await readMessages(undefined, 'peer')
      .query({ conversationId: testConversationId, since: testUserMessageId })
      .expect(403);
    await readMessages(testUserMessageId, 'peer').expect(403);
  });

  async function setupTestData() {
    const organization = await prisma.db.organization.create({
      data: { name: 'Message Reads Integration Organization', slug: fixtureId },
    });
    testOrganizationId = organization.id;

    const createReader = (role: string) =>
      prisma.db.user.create({
        data: {
          email: fixtureEmail(role),
          name: `Message Reads ${role}`,
          passwordHash: 'unused-by-request-fixture',
          memberships: {
            create: { organizationId: testOrganizationId, role: 'MEMBER' },
          },
        },
      });
    const user = await createReader('creator');
    readerId = user.id;
    peerId = (await createReader('peer')).id;

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
        restricted: true,
        createdBy: user.id,
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

    await prisma.db.projectMember.createMany({
      data: [
        { projectId: testProjectId, userId: readerId, role: 'OWNER' },
        { projectId: testProjectId, userId: peerId, role: 'MEMBER' },
      ],
    });

    const otherProject = await prisma.db.project.create({
      data: {
        name: 'Other Message Project',
        organizationId: testOrganizationId,
        status: 'ACTIVE',
      },
    });
    otherProjectId = otherProject.id;
    const otherConversation = await prisma.db.conversation.create({
      data: {
        title: 'Other Project Conversation',
        initiatedBy: 'USER',
        projectId: otherProjectId,
        organizationId: testOrganizationId,
        restricted: false,
      },
    });
    otherConversationId = otherConversation.id;
    const otherMessage = await prisma.db.message.create({
      data: {
        type: 'USER',
        status: 'OPEN',
        userId: user.id,
        projectId: otherProjectId,
        conversationId: otherConversationId,
        data: { text: 'Other project conversation message' },
        createdAt: new Date('2026-08-30T00:00:00.500Z'),
      },
    });
    otherMessageId = otherMessage.id;

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
        status: 'APPROVED',
        targetEntityId: testConversationId,
        targetEntityType: 'CONVERSATION',
        title: 'Historical proposal',
        updates: { title: 'Historical conversation title' },
        requestorId: user.id,
        requestorContext: { source: 'agent' },
        conversationId: testConversationId,
        messageId: testCarrierMessageId,
        createdAt: new Date(baseMessageTime.getTime() + 5000),
      },
    });
    testProposalId = proposal.id;
    await prisma.db.messageProposalReference.create({
      data: {
        messageId: testCarrierMessageId,
        proposalId: testProposalId,
        position: 0,
      },
    });

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
    if (!testOrganizationId) {
      return;
    }

    await prisma.db.report.deleteMany({
      where: { organizationId: testOrganizationId },
    });
    await prisma.db.proposal.deleteMany({
      where: { organizationId: testOrganizationId },
    });
    await prisma.db.message.deleteMany({
      where: {
        conversationId: {
          in: [testConversationId, otherConversationId].filter(Boolean),
        },
      },
    });
    await prisma.db.conversation.deleteMany({
      where: {
        id: { in: [testConversationId, otherConversationId].filter(Boolean) },
      },
    });
    await prisma.db.project.deleteMany({
      where: { id: { in: [testProjectId, otherProjectId].filter(Boolean) } },
    });
    await prisma.db.organization.deleteMany({
      where: { id: testOrganizationId },
    });
    await prisma.db.user.deleteMany({
      where: { email: { in: [fixtureEmail('creator'), fixtureEmail('peer')] } },
    });
  }
});
