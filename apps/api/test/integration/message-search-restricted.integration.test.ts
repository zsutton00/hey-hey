import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Entity-scoped message search over real conversations anchored to one entity:
 * an unrestricted conversation, and a restricted one created by one user.
 * The creator finds text in both; a teammate finds text only in the
 * unrestricted one and never receives any text from the restricted one.
 */
describe('GET /messages/search — restricted conversations', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let module: TestingModule;
  let creatorToken: string;
  let teammateToken: string;
  let organizationId: string;
  let projectId: string;
  let publicConversationId: string;
  let restrictedConversationId: string;

  const ANCHOR_ID = 'search-restricted-anchor';
  const ANCHOR_TYPE = 'GOAL';
  const SHARED_TERM = 'quarterly-rollout';
  const PUBLIC_TEXT = `Public note about the ${SHARED_TERM} plan`;
  const PRIVATE_TEXT = `Private note about the ${SHARED_TERM} budget`;
  const suffix = Date.now();

  const creator = {
    email: `search-creator-${suffix}@example.com`,
    password: 'SecurePassword123!',
    name: 'Search Creator',
    organizationName: `Search Restricted Org ${suffix}`,
  };
  const teammate = {
    email: `search-teammate-${suffix}@example.com`,
    password: 'SecurePassword123!',
    name: 'Search Teammate',
    organizationName: `Search Teammate Org ${suffix}`,
  };

  const search = (token: string) =>
    request(app.getHttpServer())
      .get(
        `/api/v1/organizations/${organizationId}/projects/${projectId}/messages/search`,
      )
      .set('Authorization', `Bearer ${token}`)
      .query({
        workflowAboutId: ANCHOR_ID,
        workflowAboutType: ANCHOR_TYPE,
        query: SHARED_TERM,
      })
      .expect(200);

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

  it('returns snippets from both conversations to the restricted conversation creator', async () => {
    const { body } = await search(creatorToken);

    const snippetsByConversation = new Map<string, string>(
      body.map((hit: { conversationId: string; snippet: string }) => [
        hit.conversationId,
        hit.snippet,
      ]),
    );
    expect(snippetsByConversation.get(publicConversationId)).toBe(PUBLIC_TEXT);
    expect(snippetsByConversation.get(restrictedConversationId)).toBe(
      PRIVATE_TEXT,
    );
  });

  it('returns the unrestricted snippet to a teammate and no text from the restricted conversation', async () => {
    const { body } = await search(teammateToken);

    const publicHits = body.filter(
      (hit: { conversationId: string }) =>
        hit.conversationId === publicConversationId,
    );
    expect(publicHits.map((hit: { snippet: string }) => hit.snippet)).toEqual([
      PUBLIC_TEXT,
    ]);

    const wholeResponse = JSON.stringify(body);
    expect(wholeResponse).not.toContain('Private note');
    expect(wholeResponse).not.toContain('budget');
    for (const hit of body as Array<{ snippet: string }>) {
      expect(hit.snippet).not.toContain(PRIVATE_TEXT);
    }
  });

  async function registerAndGetUserId(account: typeof creator) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(account)
      .expect(201);
    const user = await prisma.db.user.findUniqueOrThrow({
      where: { email: account.email },
      include: { memberships: true },
    });
    return {
      token: response.body.accessToken as string,
      userId: user.id,
      organizationId: user.memberships[0]!.organizationId,
    };
  }

  async function setupTestData() {
    const creatorAccount = await registerAndGetUserId(creator);
    const teammateAccount = await registerAndGetUserId(teammate);
    creatorToken = creatorAccount.token;
    teammateToken = teammateAccount.token;
    organizationId = creatorAccount.organizationId;

    await prisma.db.organizationMember.create({
      data: {
        userId: teammateAccount.userId,
        organizationId,
        role: 'MEMBER',
      },
    });

    const project = await prisma.db.project.create({
      data: {
        name: 'Search Restricted Project',
        description: 'Project for restricted message search tests',
        organizationId,
        status: 'ACTIVE',
      },
    });
    projectId = project.id;

    await prisma.db.projectMember.createMany({
      data: [
        { projectId, userId: creatorAccount.userId, role: 'OWNER' },
        { projectId, userId: teammateAccount.userId, role: 'MEMBER' },
      ],
    });

    const createConversation = (title: string, restricted: boolean) =>
      prisma.db.conversation.create({
        data: {
          title,
          workflowName: 'support',
          status: 'STARTED',
          projectId,
          organizationId,
          workflowId: `search-restricted-${title}-${suffix}`,
          initiatedBy: 'USER',
          triggerEvent: 'test_trigger',
          workflowAboutId: ANCHOR_ID,
          workflowAboutType: ANCHOR_TYPE,
          restricted,
          createdBy: creatorAccount.userId,
        },
      });
    publicConversationId = (await createConversation('public', false)).id;
    restrictedConversationId = (await createConversation('private', true)).id;

    const createMessage = (conversationId: string, text: string) =>
      prisma.db.message.create({
        data: {
          type: 'USER',
          status: 'OPEN',
          userId: creatorAccount.userId,
          projectId,
          conversationId,
          data: { message: text },
          createdAt: new Date(),
        },
      });
    await createMessage(publicConversationId, PUBLIC_TEXT);
    await createMessage(restrictedConversationId, PRIVATE_TEXT);
  }

  async function cleanupTestData() {
    try {
      await prisma.db.message.deleteMany({ where: { projectId } });
      await prisma.db.conversation.deleteMany({ where: { projectId } });
      await prisma.db.project.deleteMany({ where: { id: projectId } });
      await prisma.db.organization.deleteMany({
        where: {
          name: { in: [creator.organizationName, teammate.organizationName] },
        },
      });
    } catch (error) {
      console.error('Failed to clean up restricted search test data', error);
    }
  }
});
