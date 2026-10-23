import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Conversation Management Integration Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let module: TestingModule;
  let authToken: string;
  let testOrganizationId: string;
  let testProjectId: string;
  let testWorkflowId: string;

  // Test data for consistent testing
  const testUser = {
    email: 'conversation-test@example.com',
    password: 'SecurePassword123!',
    name: 'Conversation Test User',
    organizationName: 'Conversation Test Organization',
  };

  beforeAll(async () => {
    // INTENT: Set up full application context for integration testing
    // This creates a real NestJS application instance with all modules loaded
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    prisma = module.get<PrismaService>(PrismaService);

    await app.init();
    await setupTestData();
  });

  afterAll(async () => {
    // INTENT: Clean up test data and close connections
    await cleanupTestData();
    await app.close();
    await module.close();
  });

  beforeEach(async () => {
    // INTENT: Reset conversation data between tests
    // This ensures each test starts with a clean conversation state
    await prisma.conversation.deleteMany({
      where: {
        project: {
          organization: {
            name: testUser.organizationName,
          },
        },
      },
    });
  });

  describe('POST /api/v1/projects/:projectId/conversations', () => {
    it('should create a new conversation with valid data', async () => {
      // INTENT: Test conversation creation with proper authorization
      // This ensures users can create conversations within their projects

      const conversationData = {
        projectId: testProjectId,
        workflowId: testWorkflowId,
        initiatedBy: 'USER',
        title: 'Integration Test Conversation',
        category: 'support',
        triggerEvent: 'user_initiated',
      };

      const response = await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProjectId}/conversations`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(conversationData)
        .expect(201);

      // INTENT: Verify the response contains conversation data
      expect(response.body).toHaveProperty('id');
      expect(response.body.title).toBe(conversationData.title);
      expect(response.body.category).toBe(conversationData.category);
      expect(response.body.status).toBeDefined();

      // INTENT: Verify conversation was actually created in the database
      const createdConversation = await prisma.conversation.findUnique({
        where: { id: response.body.id },
        include: { project: true },
      });

      expect(createdConversation).toBeDefined();
      expect(createdConversation?.projectId).toBe(testProjectId);
      expect(createdConversation?.title).toBe(conversationData.title);
    });

    it('should reject conversation creation without authentication', async () => {
      // INTENT: Test security - unauthenticated requests should be rejected
      // This ensures proper access control for conversation creation

      const conversationData = {
        projectId: testProjectId,
        workflowId: testWorkflowId,
        initiatedBy: 'USER',
        title: 'Unauthorized Conversation',
        category: 'support',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProjectId}/conversations`)
        .send(conversationData)
        .expect(401);
    });

    it('should reject conversation creation for unauthorized projects', async () => {
      // INTENT: Test authorization - users should only create conversations in accessible projects
      // This ensures proper security boundaries are enforced

      const unauthorizedProjectId = 'unauthorized-project-id';
      const conversationData = {
        projectId: unauthorizedProjectId,
        workflowId: testWorkflowId,
        initiatedBy: 'USER',
        title: 'Unauthorized Project Conversation',
        category: 'support',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/projects/${unauthorizedProjectId}/conversations`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(conversationData)
        .expect(403);
    });

    it('should validate required fields for conversation creation', async () => {
      // INTENT: Test input validation for conversation data
      // This ensures API handles malformed requests appropriately

      const incompleteData = {
        // Missing required fields like projectId, workflowId, etc.
        title: 'Incomplete Conversation',
      };

      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProjectId}/conversations`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(incompleteData)
        .expect(400);
    });
  });

  describe('GET /api/v1/projects/:projectId/conversations', () => {
    beforeEach(async () => {
      // INTENT: Create sample conversations for retrieval tests
      await createSampleConversations();
    });

    it('should retrieve all conversations with pagination', async () => {
      // INTENT: Test conversation retrieval with pagination support
      // This ensures users can efficiently browse their conversation history

      const response = await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProjectId}/conversations`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          page: 1,
          limit: 10,
        })
        .expect(200);

      // INTENT: Verify paginated response structure
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toHaveProperty('page', 1);
      expect(response.body.pagination).toHaveProperty('limit', 10);
      expect(response.body.pagination).toHaveProperty('total');
    });

    it('should support filtering by conversation status', async () => {
      // INTENT: Test filtering capabilities for conversation management
      // This allows users to find conversations in specific states

      const response = await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProjectId}/conversations`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          status: 'STARTED',
        })
        .expect(200);

      // INTENT: Verify all returned conversations match the filter
      expect(response.body.data).toBeDefined();
      if (response.body.data.length > 0) {
        response.body.data.forEach((conversation: any) => {
          expect(conversation.status).toBe('STARTED');
        });
      }
    });

    it('should support search functionality', async () => {
      // INTENT: Test search capabilities for large conversation lists
      // This helps users find specific conversations quickly

      const searchTerm = 'Integration';

      const response = await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProjectId}/conversations`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          search: searchTerm,
        })
        .expect(200);

      // INTENT: Verify search results contain the search term
      expect(response.body.data).toBeDefined();
      if (response.body.data.length > 0) {
        response.body.data.forEach((conversation: any) => {
          expect(
            conversation.title.includes(searchTerm) ||
              conversation.category.includes(searchTerm.toLowerCase()),
          ).toBe(true);
        });
      }
    });

    it('should support sorting options', async () => {
      // INTENT: Test sorting capabilities for conversation organization
      // This allows users to organize conversations by different criteria

      const response = await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProjectId}/conversations`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          sortBy: 'createdAt',
          sortOrder: 'desc',
        })
        .expect(200);

      // INTENT: Verify conversations are sorted correctly
      expect(response.body.data).toBeDefined();
      if (response.body.data.length > 1) {
        const dates = response.body.data.map(
          (conv: any) => new Date(conv.createdAt),
        );
        for (let i = 1; i < dates.length; i++) {
          expect(dates[i - 1].getTime()).toBeGreaterThanOrEqual(
            dates[i].getTime(),
          );
        }
      }
    });
  });

  describe('GET /api/v1/projects/:projectId/conversations/active', () => {
    beforeEach(async () => {
      await createSampleConversations();
    });

    it('should retrieve only active conversations', async () => {
      // INTENT: Test active conversation filtering
      // This provides users with a focused view of ongoing conversations

      const response = await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProjectId}/conversations/active`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // INTENT: Verify only active conversations are returned
      expect(response.body.data).toBeDefined();
      response.body.data.forEach((conversation: any) => {
        expect(['STARTED', 'IN_PROGRESS', 'GENERATING_RESPONSE']).toContain(
          conversation.status,
        );
      });
    });
  });

  describe('GET /api/v1/projects/:projectId/conversations/:conversationId', () => {
    let testConversationId: string;

    beforeEach(async () => {
      // INTENT: Create a specific conversation for individual retrieval tests
      const conversations = await createSampleConversations();
      testConversationId = conversations[0].id;
    });

    it('should retrieve a specific conversation by ID', async () => {
      // INTENT: Test individual conversation retrieval
      // This allows users to view conversation details and history

      const response = await request(app.getHttpServer())
        .get(
          `/api/v1/projects/${testProjectId}/conversations/${testConversationId}`,
        )
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // INTENT: Verify the correct conversation is returned
      expect(response.body.id).toBe(testConversationId);
      expect(response.body).toHaveProperty('title');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('createdAt');
    });

    it('should return 404 for non-existent conversation', async () => {
      // INTENT: Test error handling for invalid conversation IDs
      // This ensures proper 404 responses for non-existent resources

      const nonExistentId = 'non-existent-conversation-id';

      await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProjectId}/conversations/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should reject access to conversations in unauthorized projects', async () => {
      // INTENT: Test authorization boundaries for conversation access
      // This prevents users from accessing conversations outside their projects

      const unauthorizedProjectId = 'unauthorized-project-id';

      await request(app.getHttpServer())
        .get(
          `/api/v1/projects/${unauthorizedProjectId}/conversations/${testConversationId}`,
        )
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });
  });

  describe('PATCH /api/v1/projects/:projectId/conversations/:conversationId', () => {
    let testConversationId: string;

    beforeEach(async () => {
      const conversations = await createSampleConversations();
      testConversationId = conversations[0].id;
    });

    it('should update conversation with valid data', async () => {
      // INTENT: Test conversation updates with proper authorization
      // This allows users to modify conversation metadata

      const updateData = {
        title: 'Updated Integration Test Conversation',
        status: 'COMPLETED',
        category: 'resolved',
      };

      const response = await request(app.getHttpServer())
        .patch(
          `/api/v1/projects/${testProjectId}/conversations/${testConversationId}`,
        )
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      // INTENT: Verify the response reflects the updates
      expect(response.body.title).toBe(updateData.title);
      expect(response.body.status).toBe(updateData.status);
      expect(response.body.category).toBe(updateData.category);

      // INTENT: Verify changes were persisted to the database
      const updatedConversation = await prisma.conversation.findUnique({
        where: { id: testConversationId },
      });

      expect(updatedConversation?.title).toBe(updateData.title);
      expect(updatedConversation?.status).toBe(updateData.status);
    });

    it('should handle partial updates correctly', async () => {
      // INTENT: Test partial updates to conversation properties
      // This allows users to update only specific fields without affecting others

      const originalConversation = await prisma.conversation.findUnique({
        where: { id: testConversationId },
      });

      const partialUpdate = {
        status: 'COMPLETED',
      };

      const response = await request(app.getHttpServer())
        .patch(
          `/api/v1/projects/${testProjectId}/conversations/${testConversationId}`,
        )
        .set('Authorization', `Bearer ${authToken}`)
        .send(partialUpdate)
        .expect(200);

      // INTENT: Verify only the specified field was updated
      expect(response.body.status).toBe(partialUpdate.status);
      expect(response.body.title).toBe(originalConversation?.title); // Should remain unchanged
    });

    it('should reject updates without proper authorization', async () => {
      // INTENT: Test authorization for conversation updates
      // This ensures users can only modify conversations they have permission for

      const updateData = {
        title: 'Unauthorized Update',
      };

      await request(app.getHttpServer())
        .patch(
          `/api/v1/projects/${testProjectId}/conversations/${testConversationId}`,
        )
        .send(updateData) // No auth token
        .expect(401);
    });
  });

  // Helper functions for test setup and teardown

  async function setupTestData() {
    // INTENT: Create test user and associated data for conversation tests
    // This provides the necessary authentication and project context

    // Register test user
    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(testUser);

    authToken = registerResponse.body.accessToken;

    // Get user and organization data
    const user = await prisma.user.findUnique({
      where: { email: testUser.email },
      include: { memberships: { include: { organization: true } } },
    });

    // testUserId = user!.id;
    testOrganizationId = user.memberships[0].organizationId;

    // Create test project
    const project = await prisma.project.create({
      data: {
        name: 'Integration Test Project',
        description: 'Project for integration tests',
        organizationId: testOrganizationId,
        status: 'ACTIVE',
      },
    });

    testProjectId = project.id;

    // Use a mock Temporal workflow ID (workflows are managed by Temporal, not stored in DB)
    testWorkflowId = 'test-workflow-id-' + Date.now();
  }

  async function createSampleConversations() {
    // INTENT: Create sample conversations for testing retrieval and update operations
    const conversations: any[] = [];

    for (let i = 1; i <= 3; i++) {
      const conversation = await prisma.conversation.create({
        data: {
          title: `Integration Test Conversation ${i}`,
          workflowName: i === 1 ? 'support' : 'general',
          status: i === 3 ? 'COMPLETED' : 'STARTED',
          projectId: testProjectId,
          organizationId: testOrganizationId,
          workflowId: testWorkflowId,
          initiatedBy: 'USER',
          triggerEvent: 'test_trigger',
        },
      });

      conversations.push(conversation);
    }

    return conversations;
  }

  async function cleanupTestData() {
    // INTENT: Remove test data to prevent pollution between test runs
    try {
      await prisma.conversation.deleteMany({
        where: {
          project: {
            organization: {
              name: testUser.organizationName,
            },
          },
        },
      });

      await prisma.project.deleteMany({
        where: {
          organization: {
            name: testUser.organizationName,
          },
        },
      });

      // Workflows are managed by Temporal, not stored in database

      await prisma.organizationMember.deleteMany({
        where: {
          user: {
            email: testUser.email,
          },
        },
      });

      await prisma.user.deleteMany({
        where: {
          email: testUser.email,
        },
      });

      await prisma.organization.deleteMany({
        where: {
          name: testUser.organizationName,
        },
      });
    } catch (error) {
      console.warn('Cleanup warning:', error);
    }
  }
});
