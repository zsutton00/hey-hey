import { createHmac } from 'node:crypto';
import { Integration, IntegrationTargetType } from '@prisma/client';
import { Request } from 'express';
import { WebhookController } from '../controllers/webhook.controller';
import { GitHubIntegrationHandler } from '../integration/handlers/github.integration.handler';
import { ConfigEncryptionService } from '../services/config-encryption.service';
import { ArtifactService } from '../services/artifacts/artifact.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventPublisher } from '../core/events/domain-event-publisher';
import { IntegrationId } from '../types';

describe('GitHub webhook ingestion boundary', () => {
  const secret = 'integration-specific-secret';
  const integrationA = makeIntegration(
    '9bd92fd6-16b1-4f8c-a773-b07ae4cc1f90',
    '66d4eeec-e20c-429f-bef9-b58471668bf2',
  );
  const integrationB = makeIntegration(
    '5163845f-bef9-4d67-97b1-8f356832e8e0',
    'af15e2ca-68c6-463a-9187-c29cc6e34195',
  );
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

  function makeIntegration(id: string, projectId: string): Integration {
    return {
      id,
      organizationId: 'f7ac166f-aef2-4fbe-a514-0f96bc5ac924',
      projectId,
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
  }

  function createBoundary() {
    const inbox = new Map<
      string,
      { id: string; acceptedAt: Date; data: Record<string, unknown> }
    >();
    const outbox: Array<Record<string, unknown>> = [];
    let tail = Promise.resolve();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
      gitHubWebhookInbox: {
        findUnique: jest.fn(async ({ where }: any) => {
          const key = where.integrationId_deliveryId;
          return inbox.get(`${key.integrationId}:${key.deliveryId}`) ?? null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `inbox-${inbox.size + 1}`,
            acceptedAt: new Date('2026-08-18T18:01:00.000Z'),
            data,
          };
          inbox.set(`${data.integrationId}:${data.deliveryId}`, row);
          return row;
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        <T>(callback: (client: typeof tx) => Promise<T>): Promise<T> => {
          const result = tail.then(() => callback(tx));
          tail = result.then(
            () => undefined,
            () => undefined,
          );
          return result;
        },
      ),
    };
    const publisher = {
      publishInTransaction: jest.fn(async (_tx, event) => {
        outbox.push(event);
        return `outbox-${outbox.length}`;
      }),
    };
    const handler = new GitHubIntegrationHandler(
      {} as ConfigEncryptionService,
      {} as ArtifactService,
      prisma as unknown as PrismaService,
      publisher as unknown as DomainEventPublisher,
    );
    const integrations = new Map([
      [integrationA.id, integrationA],
      [integrationB.id, integrationB],
    ]);
    const integrationService = {
      findActiveGitHubIntegrationWithDecryptedConfig: jest.fn(async (id) => {
        const integration = integrations.get(id);
        if (!integration) {
          throw new Error('integration not found');
        }
        return {
          ...integration,
          config: {
            token: 'token',
            webhookSecret: secret,
            repositoryUrl: 'https://github.com/hey-hey/api',
          },
          createdAt: integration.createdAt.toISOString(),
          updatedAt: integration.updatedAt.toISOString(),
        };
      }),
      dtoToIntegration: jest.fn((dto) => integrations.get(dto.id)),
    };
    const controller = new WebhookController(
      integrationService as any,
      handler,
    );
    return { controller, inbox, outbox };
  }

  async function request() {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = `sha256=${createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;
    return {
      rawBody,
      signature,
      request: {
        rawBody,
        ip: '127.0.0.1',
        connection: {},
      } as Request & { rawBody: Buffer },
    };
  }

  async function deliver(
    controller: WebhookController,
    integrationId: IntegrationId,
    deliveryId: string,
  ) {
    const signed = await request();
    return controller.handleGitHubWebhook(
      integrationId,
      signed.request,
      payload,
      'pull_request',
      signed.signature,
      deliveryId,
    );
  }

  it('converges sequential and concurrent retries without repeated effects', async () => {
    const { controller, inbox, outbox } = createBoundary();
    await deliver(controller, integrationA.id as IntegrationId, 'delivery-1');
    await deliver(controller, integrationA.id as IntegrationId, 'delivery-1');
    await Promise.all([
      deliver(controller, integrationA.id as IntegrationId, 'delivery-2'),
      deliver(controller, integrationA.id as IntegrationId, 'delivery-2'),
    ]);

    expect(inbox.size).toBe(2);
    expect(outbox).toHaveLength(2);
    expect(outbox.map((event) => event.type)).toEqual([
      'github.webhook.accepted',
      'github.webhook.accepted',
    ]);
    const firstInbox = [...inbox.values()][0];
    const firstOutbox = outbox[0];
    if (!firstInbox || !firstOutbox) {
      throw new Error('Expected accepted inbox and outbox records');
    }
    const firstInboxEvent = firstInbox.data.normalizedEvent as Record<
      string,
      unknown
    >;
    const firstOutboxPayload = firstOutbox.payload as Record<string, unknown>;
    expect(firstInboxEvent.pullRequest).toEqual({
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
    });
    expect(firstOutboxPayload.pullRequest).toEqual(
      firstInboxEvent.pullRequest,
    );
  });

  it('isolates the same repository and delivery identity between projects', async () => {
    const { controller, inbox, outbox } = createBoundary();
    await Promise.all([
      deliver(controller, integrationA.id as IntegrationId, 'delivery-1'),
      deliver(controller, integrationB.id as IntegrationId, 'delivery-1'),
    ]);

    expect(inbox.size).toBe(2);
    expect(outbox).toHaveLength(2);
    expect(outbox.map((event: any) => event.payload.projectId).sort()).toEqual(
      [integrationA.projectId, integrationB.projectId].sort(),
    );
  });
});
