import { Test, TestingModule } from '@nestjs/testing';
import { GitHubIntegrationHandler } from '../github.integration.handler';
import { ConfigEncryptionService } from '../../../services/config-encryption.service';
import { ArtifactService } from '../../../services/artifacts/artifact.service';
import { Integration, IntegrationTargetType } from '@prisma/client';
import { OrganizationId } from '../../../types';
import { PrismaService } from '../../../prisma/prisma.service';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
};

// Mock the graphql module
jest.mock('@octokit/graphql', () => ({
  graphql: {
    defaults: jest.fn(() => jest.fn()),
  },
}));

describe('GitHubIntegrationHandler - getSuggestedUsers', () => {
  let handler: GitHubIntegrationHandler;
  let mockGraphqlClient: jest.Mock;

  const mockOrganizationId = 'org-123' as OrganizationId;
  const mockIntegration: Integration = {
    id: 'int-123',
    organizationId: mockOrganizationId,
    projectId: 'proj-123',
    type: 'github',
    name: 'GitHub Integration',
    description: null,
    config: {
      token: 'encrypted-token',
      owner: 'test-owner',
      repositoryUrl: 'https://github.com/test-owner/test-repo',
    },
    state: 'ACTIVE',
    targetType: 'ORGANIZATION',
    connectionStatus: 'CONNECTED',
    lastConnectionCheck: new Date(),
    lastSuccessfulSync: new Date(),
    errorMessage: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockDecryptedConfig = {
    token: 'github-token-123',
    owner: 'test-owner',
    repositoryUrl: 'https://github.com/test-owner/test-repo',
    organization: 'test-org',
  };

  beforeEach(async () => {
    mockGraphqlClient = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubIntegrationHandler,
        {
          provide: ConfigEncryptionService,
          useValue: {
            decryptConfig: jest.fn(),
          },
        },
        {
          provide: ArtifactService,
          useValue: {
            createMany: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: DomainEventPublisher,
          useValue: { publishInTransaction: jest.fn() },
        },
      ],
    }).compile();

    handler = module.get<GitHubIntegrationHandler>(GitHubIntegrationHandler);

    // Mock the createGraphQLClient method
    jest
      .spyOn(handler as any, 'createGraphQLClient')
      .mockReturnValue(mockGraphqlClient);
    jest
      .spyOn(handler as any, 'getDecryptedConfig')
      .mockResolvedValue(mockDecryptedConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSuggestedUsers', () => {
    it('should successfully get suggested users from repository collaborators', async () => {
      // Arrange
      const mockCollaboratorsResponse = {
        repository: {
          collaborators: {
            nodes: [
              {
                login: 'johndoe',
                name: 'John Doe',
                email: 'john@example.com',
                createdAt: '2023-01-01T00:00:00Z',
              },
            ],
            pageInfo: {
              hasNextPage: false,
              endCursor: null as string | null,
            },
          },
        },
      };

      mockGraphqlClient
        .mockResolvedValueOnce(mockCollaboratorsResponse) // Repository collaborators
        .mockResolvedValueOnce({ organization: { members: { nodes: [] } } }) // Org members (empty)
        .mockResolvedValueOnce({
          repository: { issues: { nodes: [] }, pullRequests: { nodes: [] } },
        }); // Activity (empty)

      // Act
      const result = await handler.getSuggestedUsers(
        mockIntegration,
        'proj-123',
      );

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'John Doe',
        email: 'john@example.com',
        sources: ['github'],
        confidence: 0.8,
        integrationMetadata: {
          githubLogin: 'johndoe',
          source: 'repository_collaborator',
          repository: 'test-owner/test-repo',
        },
      });
    });

    it('should handle GraphQL API errors gracefully', async () => {
      // Arrange
      mockGraphqlClient.mockRejectedValue(new Error('GitHub API Error'));

      // Act
      const result = await handler.getSuggestedUsers(
        mockIntegration,
        'proj-123',
      );

      // Assert - Should return empty array when API fails, not throw error
      expect(result).toEqual([]);
    });

    it('should handle missing email addresses by filtering them out', async () => {
      // Arrange
      const mockCollaboratorsResponse = {
        repository: {
          collaborators: {
            nodes: [
              {
                login: 'user-with-email',
                name: 'User With Email',
                email: 'user@example.com',
                createdAt: '2023-01-01T00:00:00Z',
              },
              {
                login: 'user-without-email',
                name: 'User Without Email',
                email: null, // No email
                createdAt: '2023-01-01T00:00:00Z',
              },
            ],
            pageInfo: {
              hasNextPage: false,
              endCursor: null as string | null,
            },
          },
        },
      };

      mockGraphqlClient
        .mockResolvedValueOnce(mockCollaboratorsResponse)
        .mockResolvedValueOnce({ organization: { members: { nodes: [] } } })
        .mockResolvedValueOnce({
          repository: { issues: { nodes: [] }, pullRequests: { nodes: [] } },
        });

      // Act
      const result = await handler.getSuggestedUsers(
        mockIntegration,
        'proj-123',
      );

      // Assert
      expect(result).toHaveLength(1);
      const firstUser = assertDefined(result[0], 'first suggested user');
      expect(firstUser.email).toBe('user@example.com');
    });
  });
});

describe('GitHubIntegrationHandler - webhook acceptance', () => {
  const integration = {
    id: '9bd92fd6-16b1-4f8c-a773-b07ae4cc1f90',
    organizationId: 'f7ac166f-aef2-4fbe-a514-0f96bc5ac924',
    projectId: '66d4eeec-e20c-429f-bef9-b58471668bf2',
    type: 'GITHUB',
    name: 'GitHub',
    description: null,
    config: {},
    state: 'ACTIVE',
    targetType: IntegrationTargetType.ORGANIZATION,
    connectionStatus: 'CONNECTED',
    lastConnectionCheck: null,
    lastSuccessfulSync: null,
    errorMessage: null,
    createdBy: null,
    createdAt: new Date('2026-08-18T17:00:00.000Z'),
    updatedAt: new Date('2026-08-18T17:00:00.000Z'),
    deletedAt: null,
  } as Integration;
  const payload = {
    action: 'closed',
    repository: {
      id: 42,
      name: 'api',
      full_name: 'hey-hey/api',
      html_url: 'https://github.com/hey-hey/api',
      clone_url: 'https://github.com/hey-hey/api.git',
      ssh_url: 'git@github.com:hey-hey/api.git',
      private: true,
      owner: { login: 'hey-hey', id: 7, type: 'Organization' as const },
    },
    pull_request: {
      id: 100,
      number: 12,
      title: 'Preserve accepted merge facts',
      state: 'closed',
      merged: true,
      merged_at: '2026-08-18T18:00:00.000Z',
      merged_by: { login: 'octocat' },
      html_url: 'https://github.com/hey-hey/api/pull/12',
      head: { sha: 'abc123' },
      base: { sha: 'def456' },
    },
  };

  it('persists one inbox row and one exact normalized outbox event', async () => {
    const inbox = {
      id: 'ef0099ee-468b-4841-a473-df9f9363a15f',
      acceptedAt: new Date('2026-08-18T18:01:00.000Z'),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
      gitHubWebhookInbox: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(inbox),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const publisher = {
      publishInTransaction: jest.fn().mockResolvedValue('outbox-1'),
    };
    const handler = new GitHubIntegrationHandler(
      {} as ConfigEncryptionService,
      {} as ArtifactService,
      prisma as unknown as PrismaService,
      publisher as unknown as DomainEventPublisher,
    );
    const rawBody = Buffer.from(JSON.stringify(payload));

    await expect(
      handler.handleWebhook(
        {
          payload,
          rawBody,
          eventName: 'pull_request',
          deliveryId: 'delivery-1',
        },
        integration,
      ),
    ).resolves.toEqual({
      accepted: true,
      duplicate: false,
      inboxId: inbox.id,
    });

    expect(tx.gitHubWebhookInbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        integrationId: integration.id,
        organizationId: integration.organizationId,
        projectId: integration.projectId,
        deliveryId: 'delivery-1',
        eventName: 'pull_request',
        repositoryFullName: 'hey-hey/api',
        payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        normalizedEvent: {
          repository: {
            id: 42,
            fullName: 'hey-hey/api',
            htmlUrl: 'https://github.com/hey-hey/api',
          },
          action: 'closed',
          pullRequest: {
            id: 100,
            number: 12,
            title: 'Preserve accepted merge facts',
            state: 'closed',
            merged: true,
            mergedAt: '2026-08-18T18:00:00.000Z',
            mergedByLogin: 'octocat',
            htmlUrl: 'https://github.com/hey-hey/api/pull/12',
            headSha: 'abc123',
            baseSha: 'def456',
          },
        },
      }),
    });
    expect(publisher.publishInTransaction).toHaveBeenCalledWith(tx, {
      type: 'github.webhook.accepted',
      aggregateId: inbox.id,
      payload: {
        organizationId: integration.organizationId,
        projectId: integration.projectId,
        integrationId: integration.id,
        inboxId: inbox.id,
        deliveryId: 'delivery-1',
        eventName: 'pull_request',
        repository: {
          id: 42,
          fullName: 'hey-hey/api',
          htmlUrl: 'https://github.com/hey-hey/api',
        },
        action: 'closed',
        pullRequest: {
          id: 100,
          number: 12,
          title: 'Preserve accepted merge facts',
          state: 'closed',
          merged: true,
          mergedAt: '2026-08-18T18:00:00.000Z',
          mergedByLogin: 'octocat',
          htmlUrl: 'https://github.com/hey-hey/api/pull/12',
          headSha: 'abc123',
          baseSha: 'def456',
        },
        acceptedAt: '2026-08-18T18:01:00.000Z',
      },
    });
  });

  it('rejects a merged pull request without a merge actor', async () => {
    const handler = new GitHubIntegrationHandler(
      {} as ConfigEncryptionService,
      {} as ArtifactService,
      { $transaction: jest.fn() } as unknown as PrismaService,
      { publishInTransaction: jest.fn() } as unknown as DomainEventPublisher,
    );
    const invalidPayload = {
      ...payload,
      pull_request: {
        ...payload.pull_request,
        merged_by: null,
      },
    };

    await expect(
      handler.handleWebhook(
        {
          payload: invalidPayload,
          rawBody: Buffer.from(JSON.stringify(invalidPayload)),
          eventName: 'pull_request',
          deliveryId: 'delivery-missing-actor',
        },
        integration,
      ),
    ).rejects.toThrow('Invalid GitHub pull request payload');
  });

  it('normalizes a non-merged pull request actor to null', async () => {
    const inbox = {
      id: '8386c499-5c72-4d58-bfde-e526a9a24c6c',
      acceptedAt: new Date('2026-08-18T18:01:00.000Z'),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
      gitHubWebhookInbox: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(inbox),
      },
    };
    const publisher = {
      publishInTransaction: jest.fn().mockResolvedValue('outbox-1'),
    };
    const handler = new GitHubIntegrationHandler(
      {} as ConfigEncryptionService,
      {} as ArtifactService,
      {
        $transaction: jest.fn(
          async (callback: (client: typeof tx) => unknown) => callback(tx),
        ),
      } as unknown as PrismaService,
      publisher as unknown as DomainEventPublisher,
    );
    const nonMergedPayload = {
      ...payload,
      action: 'opened',
      pull_request: {
        ...payload.pull_request,
        state: 'open',
        merged: false,
        merged_at: null,
        merged_by: { login: 'ignored-actor' },
      },
    };

    await handler.handleWebhook(
      {
        payload: nonMergedPayload,
        rawBody: Buffer.from(JSON.stringify(nonMergedPayload)),
        eventName: 'pull_request',
        deliveryId: 'delivery-not-merged',
      },
      integration,
    );

    const normalizedEvent = tx.gitHubWebhookInbox.create.mock.calls[0][0].data
      .normalizedEvent;
    const acceptedPayload = publisher.publishInTransaction.mock.calls[0][1]
      .payload;
    expect(normalizedEvent.pullRequest).toEqual(
      expect.objectContaining({
        title: 'Preserve accepted merge facts',
        merged: false,
        mergedByLogin: null,
      }),
    );
    expect(acceptedPayload.pullRequest).toEqual(
      normalizedEvent.pullRequest,
    );
  });

  it('converges concurrent delivery replays on one inbox and outbox effect', async () => {
    const stored = new Map<string, { id: string; acceptedAt: Date }>();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
      gitHubWebhookInbox: {
        findUnique: jest.fn(async () => stored.get('delivery-1') ?? null),
        create: jest.fn(async () => {
          const row = {
            id: 'ef0099ee-468b-4841-a473-df9f9363a15f',
            acceptedAt: new Date('2026-08-18T18:01:00.000Z'),
          };
          stored.set('delivery-1', row);
          return row;
        }),
      },
    };
    let transactionTail = Promise.resolve();
    const prisma = {
      $transaction: jest.fn(
        <T>(callback: (client: typeof tx) => Promise<T>): Promise<T> => {
          const result = transactionTail.then(() => callback(tx));
          transactionTail = result.then(
            () => undefined,
            () => undefined,
          );
          return result;
        },
      ),
    };
    const publisher = {
      publishInTransaction: jest.fn().mockResolvedValue('outbox-1'),
    };
    const handler = new GitHubIntegrationHandler(
      {} as ConfigEncryptionService,
      {} as ArtifactService,
      prisma as unknown as PrismaService,
      publisher as unknown as DomainEventPublisher,
    );
    const input = {
      payload,
      rawBody: Buffer.from(JSON.stringify(payload)),
      eventName: 'pull_request',
      deliveryId: 'delivery-1',
    };

    const results = await Promise.all([
      handler.handleWebhook(input, integration),
      handler.handleWebhook(input, integration),
    ]);

    expect(results).toEqual([
      {
        accepted: true,
        duplicate: false,
        inboxId: 'ef0099ee-468b-4841-a473-df9f9363a15f',
      },
      {
        accepted: true,
        duplicate: true,
        inboxId: 'ef0099ee-468b-4841-a473-df9f9363a15f',
      },
    ]);
    expect(tx.gitHubWebhookInbox.create).toHaveBeenCalledTimes(1);
    expect(publisher.publishInTransaction).toHaveBeenCalledTimes(1);
  });
});
