import { ConversationStatus, MessageStatus } from '../../src/generated';

interface MockData {
  conversations: Map<string, any>;
  messages: Map<string, any>;
  initiatives: Map<string, any>;
  projects: Map<string, any>;
  organizations: Map<string, any>;
  users: Map<string, any>;
}

/**
 * Creates a mock PrismaService that stores data in memory
 * This provides a functional test environment without database dependencies
 */
export function createMockPrismaService() {
  const data: MockData = {
    conversations: new Map(),
    messages: new Map(),
    initiatives: new Map(),
    projects: new Map(),
    organizations: new Map(),
    users: new Map(),
  };

  // Helper to generate IDs
  let idCounter = 0;
  const generateId = (prefix: string) =>
    `${prefix}-${Date.now()}-${++idCounter}`;

  const mockPrismaService = {
    // Organization methods
    organization: {
      create: jest.fn().mockImplementation(({ data: orgData }) => {
        const org = {
          id: orgData.id || generateId('org'),
          ...orgData,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        data.organizations.set(org.id, org);
        return Promise.resolve(org);
      }),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        if (where?.id) {
          return Promise.resolve(data.organizations.get(where.id) || null);
        }
        return Promise.resolve(
          Array.from(data.organizations.values())[0] || null,
        );
      }),
    },

    // Project methods
    project: {
      create: jest.fn().mockImplementation(({ data: projData }) => {
        const project = {
          id: projData.id || generateId('proj'),
          ...projData,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        data.projects.set(project.id, project);
        return Promise.resolve(project);
      }),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        if (where?.id) {
          return Promise.resolve(data.projects.get(where.id) || null);
        }
        if (where?.organizationId) {
          return Promise.resolve(
            Array.from(data.projects.values()).find(
              (p) => p.organizationId === where.organizationId,
            ) || null,
          );
        }
        return Promise.resolve(Array.from(data.projects.values())[0] || null);
      }),
    },

    // User methods
    user: {
      create: jest.fn().mockImplementation(({ data: userData }) => {
        const user = {
          id: userData.id || generateId('user'),
          ...userData,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        data.users.set(user.id, user);
        return Promise.resolve(user);
      }),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        if (where?.id) {
          return Promise.resolve(data.users.get(where.id) || null);
        }
        return Promise.resolve(Array.from(data.users.values())[0] || null);
      }),
    },

    // Conversation methods
    conversation: {
      create: jest.fn().mockImplementation(({ data: convData }) => {
        const conversation = {
          id: convData.id || generateId('conv'),
          status: ConversationStatus.Started,
          ...convData,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        data.conversations.set(conversation.id, conversation);
        return Promise.resolve(conversation);
      }),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        if (where?.id) {
          return Promise.resolve(data.conversations.get(where.id) || null);
        }
        if (where?.workflowId) {
          return Promise.resolve(
            Array.from(data.conversations.values()).find(
              (c) => c.workflowId === where.workflowId,
            ) || null,
          );
        }
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockImplementation(({ where }) => {
        let results = Array.from(data.conversations.values());
        if (where?.projectId) {
          results = results.filter((c) => c.projectId === where.projectId);
        }
        return Promise.resolve(results);
      }),
      update: jest.fn().mockImplementation(({ where, data: updateData }) => {
        const conv = data.conversations.get(where.id);
        if (conv) {
          const updated = { ...conv, ...updateData, updatedAt: new Date() };
          data.conversations.set(conv.id, updated);
          return Promise.resolve(updated);
        }
        return Promise.resolve(null);
      }),
    },

    // Message methods
    message: {
      create: jest.fn().mockImplementation(({ data: msgData }) => {
        const message = {
          id: msgData.id || generateId('msg'),
          status: MessageStatus.Completed,
          ...msgData,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        data.messages.set(message.id, message);
        return Promise.resolve(message);
      }),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        if (where?.id) {
          return Promise.resolve(data.messages.get(where.id) || null);
        }
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockImplementation(({ where, orderBy }) => {
        let results = Array.from(data.messages.values());

        if (where?.conversationId) {
          results = results.filter(
            (m) => m.conversationId === where.conversationId,
          );
        }

        // Handle ordering
        if (orderBy?.createdAt) {
          results.sort((a, b) => {
            const aTime = a.createdAt.getTime();
            const bTime = b.createdAt.getTime();
            return orderBy.createdAt === 'desc' ? bTime - aTime : aTime - bTime;
          });
        }

        return Promise.resolve(results);
      }),
      update: jest.fn().mockImplementation(({ where, data: updateData }) => {
        const msg = data.messages.get(where.id);
        if (msg) {
          const updated = { ...msg, ...updateData, updatedAt: new Date() };
          data.messages.set(msg.id, updated);
          return Promise.resolve(updated);
        }
        return Promise.resolve(null);
      }),
    },

    // Initiative methods
    initiative: {
      create: jest.fn().mockImplementation(({ data: initData }) => {
        const initiative = {
          id: initData.id || generateId('init'),
          ...initData,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        data.initiatives.set(initiative.id, initiative);
        return Promise.resolve(initiative);
      }),
      findMany: jest.fn().mockImplementation(({ where }) => {
        let results = Array.from(data.initiatives.values());

        if (where?.projects?.some) {
          results = results.filter(
            (init) => init.projectId === where.projects.some.projectId,
          );
        }

        return Promise.resolve(results);
      }),
    },

    // Database-level access (for services that use db.*)
    db: {
      conversation: {
        findFirst: function (args: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return mockPrismaService.conversation.findFirst(args);
        },
        findMany: function (args: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return mockPrismaService.conversation.findMany(args);
        },
        create: function (args: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return mockPrismaService.conversation.create(args);
        },
        update: function (args: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return mockPrismaService.conversation.update(args);
        },
      },
      message: {
        findFirst: function (args: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return mockPrismaService.message.findFirst(args);
        },
        findMany: function (args: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return mockPrismaService.message.findMany(args);
        },
        create: function (args: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return mockPrismaService.message.create(args);
        },
        update: function (args: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return mockPrismaService.message.update(args);
        },
      },
      project: {
        findFirst: function (args: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return mockPrismaService.project.findFirst(args);
        },
      },
      organization: {
        findFirst: function (args: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return mockPrismaService.organization.findFirst(args);
        },
      },
      user: {
        findFirst: function (args: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return mockPrismaService.user.findFirst(args);
        },
      },
      initiative: {
        create: function (args: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return mockPrismaService.initiative.create(args);
        },
        findMany: function (args: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return mockPrismaService.initiative.findMany(args);
        },
      },
    },

    // Transaction support
    $transaction: jest.fn().mockImplementation(async (fn) => {
      if (typeof fn === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return fn(mockPrismaService);
      }
      // For array of promises
      return Promise.all(fn);
    }),

    // Connection methods
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),

    // Module lifecycle methods (for NestJS compatibility)
    onModuleInit: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),

    // Test helpers
    _reset: () => {
      data.conversations.clear();
      data.messages.clear();
      data.initiatives.clear();
      jest.clearAllMocks();
    },
    _getData: () => data,
  };

  return mockPrismaService;
}

/**
 * Seeds test data into the mock PrismaService
 */
export async function seedMockData(
  prisma: ReturnType<typeof createMockPrismaService>,
  options: {
    organizationId: string;
    projectId: string;
    userId: string;
  },
) {
  const { organizationId, projectId, userId } = options;

  // Create organization
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: 'Test Organization',
      slug: 'test-org',
    },
  });

  // Create user
  await prisma.user.create({
    data: {
      id: userId,
      email: 'test@example.com',
      name: 'Test User',
    },
  });

  // Create project
  await prisma.project.create({
    data: {
      id: projectId,
      name: 'Test Project',
      organizationId,
    },
  });
}
