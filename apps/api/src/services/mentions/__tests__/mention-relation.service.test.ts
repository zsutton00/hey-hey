import { EntityType, ArtifactRelationType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MentionRelationService } from '../mention-relation.service';
import * as TestUtils from '../../../utils/testUtils';
import { MessageCreatedEvent } from '../../../generated/model/messageCreatedEvent';
import { EVENT_TYPES } from '../../../core/events/types/event.types';

const { testIds } = TestUtils;

const createMessageCreatedEvent = (
  overrides: Partial<MessageCreatedEvent> = {},
): MessageCreatedEvent => ({
  id: 'event-1',
  type: EVENT_TYPES.MESSAGE.CREATED,
  aggregateId: testIds.message,
  payload: {
    payloadType: EVENT_TYPES.MESSAGE.CREATED,
    organizationId: testIds.organization,
    projectId: testIds.project,
    conversationId: testIds.conversation,
    workflowId: testIds.workflow,
    message: {
      type: 'USER',
      workflowId: testIds.workflow,
      projectId: testIds.project,
      status: 'completed',
      userId: testIds.user,
      conversationId: testIds.conversation,
      parentMessageId: testIds.parentMessage,
      parentMessage: {
        id: testIds.parentMessage,
        content: 'Parent message content',
      },
      data: { message: 'hello' },
      shouldProcess: true,
    } as any,
    mentions: [],
  },
  ...overrides,
});

describe('MentionRelationService', () => {
  let service: MentionRelationService;
  let prismaService: ReturnType<typeof TestUtils.createMockPrismaService>;

  beforeEach(() => {
    prismaService = TestUtils.createMockPrismaService();
    const db = prismaService.db as any;
    db.artifactRelation = { createMany: jest.fn() };

    service = new MentionRelationService(
      prismaService as unknown as PrismaService,
    );
  });

  it('skips design doc mentions (no longer persisted)', async () => {
    prismaService.db.conversation.findUnique = jest.fn().mockResolvedValue({
      workflowAboutId: 'design-doc-1',
      workflowAboutType: 'design-doc',
    });

    const event = createMessageCreatedEvent({
      payload: {
        ...createMessageCreatedEvent().payload,
        mentions: [
          { entityId: 'task-1', entityType: EntityType.TASK },
          { entityId: 'design-doc-2', entityType: EntityType.DESIGN_DOC },
        ],
      },
    });

    await service.createRelationsForMessage(event);

    expect(prismaService.db.artifactRelation.createMany).not.toHaveBeenCalled();
  });

  it('creates artifact mention relations', async () => {
    prismaService.db.conversation.findUnique = jest.fn().mockResolvedValue({
      workflowAboutId: 'artifact-1',
      workflowAboutType: 'artifact',
    });

    const event = createMessageCreatedEvent({
      payload: {
        ...createMessageCreatedEvent().payload,
        mentions: [
          { entityId: 'artifact-2', entityType: EntityType.ARTIFACT },
          { entityId: 'task-1', entityType: EntityType.TASK },
        ],
      },
    });

    await service.createRelationsForMessage(event);

    expect(prismaService.db.artifactRelation.createMany).toHaveBeenCalledWith({
      data: [
        {
          sourceId: 'artifact-1',
          targetId: 'artifact-2',
          relationType: ArtifactRelationType.MENTIONED_IN,
        },
      ],
      skipDuplicates: true,
    });
  });

  it('skips when workflow about metadata is missing', async () => {
    prismaService.db.conversation.findUnique = jest
      .fn()
      .mockResolvedValue(null);

    const event = createMessageCreatedEvent({
      payload: {
        ...createMessageCreatedEvent().payload,
        mentions: [{ entityId: 'task-1', entityType: EntityType.TASK }],
      },
    });

    await service.createRelationsForMessage(event);

    expect(prismaService.db.artifactRelation.createMany).not.toHaveBeenCalled();
  });
});
