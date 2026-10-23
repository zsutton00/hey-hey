import { EVENT_TYPES } from 'src/core/events/types/event.types';
import { GitHubWebhookAcceptedEvent } from 'src/core/events/types/domain-events';
import { NotificationGenerationProcessor } from 'src/core/processing/notification-generation-processor.service';
import { EntityType, NotificationEventType } from 'src/generated';
import { OrganizationId, ProjectId } from 'src/types';
import { createMockPrismaService } from 'src/utils/testUtils';

const ORGANIZATION_ID =
  '11111111-1111-4111-8111-111111111111' as OrganizationId;
const PROJECT_ID = '22222222-2222-4222-8222-222222222222' as ProjectId;
const RECIPIENT_ID = '33333333-3333-4333-8333-333333333333';
const ARTIFACT_ID = '44444444-4444-4444-8444-444444444444';
const TASK_ID = '55555555-5555-4555-8555-555555555555';

const buildAcceptedMergeEvent = (
  overrides?: Partial<GitHubWebhookAcceptedEvent>,
): GitHubWebhookAcceptedEvent => ({
  id: 'github-event-1',
  type: EVENT_TYPES.GITHUB_WEBHOOK.ACCEPTED,
  aggregateId: 'inbox-1',
  payload: {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    integrationId: '66666666-6666-4666-8666-666666666666',
    inboxId: 'inbox-1',
    deliveryId: 'delivery-1',
    eventName: 'pull_request',
    action: 'closed',
    repository: {
      id: 42,
      fullName: 'hey-hey/api',
      htmlUrl: 'https://github.com/hey-hey/api',
    },
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
  ...overrides,
});

describe('GitHub merge notification integration', () => {
  it('emits one typed project notification for a replayed accepted merge', async () => {
    const prisma = createMockPrismaService();
    const publish = jest.fn().mockResolvedValue('outbox-notification-1');
    (prisma.db as any).integration = {
      findFirst: jest.fn().mockResolvedValue({ createdBy: RECIPIENT_ID }),
    };
    prisma.db.project.findFirst.mockResolvedValue({
      id: PROJECT_ID,
      name: 'Hey Hey Project',
      createdBy: RECIPIENT_ID,
    });
    prisma.db.artifact.findFirst.mockResolvedValue({
      id: ARTIFACT_ID,
      title: 'PR #12: Preserve accepted merge facts',
      taskRelations: [{ task: { id: TASK_ID, name: 'Consume merge event' } }],
    } as any);

    const service = new NotificationGenerationProcessor(
      prisma as any,
      { publish } as any,
      { getMessage: jest.fn() } as any,
      undefined,
    );
    const merge = buildAcceptedMergeEvent();

    await service.handleGitHubWebhookAcceptedEvent(
      buildAcceptedMergeEvent({
        payload: { ...merge.payload, action: 'synchronize' },
      }),
    );
    await service.handleGitHubWebhookAcceptedEvent(merge);
    await service.handleGitHubWebhookAcceptedEvent(merge);

    expect(publish).toHaveBeenCalledTimes(1);
    const emitted = publish.mock.calls[0]?.[0] as any;
    expect(emitted.payload.projectId).toBe(PROJECT_ID);
    expect(emitted.payload.userId).toBe(RECIPIENT_ID);
    expect(emitted.payload.notification).toMatchObject({
      eventType: NotificationEventType.PullRequestMerged,
      entityType: EntityType.Artifact,
      entityId: ARTIFACT_ID,
      payload: {
        repositoryName: 'hey-hey/api',
        pullRequestNumber: 12,
        pullRequestTitle: 'Preserve accepted merge facts',
        pullRequestUrl: 'https://github.com/hey-hey/api/pull/12',
        mergedAt: '2026-08-18T18:00:00.000Z',
        actorLogin: 'octocat',
        taskId: TASK_ID,
      },
    });
  });
});
