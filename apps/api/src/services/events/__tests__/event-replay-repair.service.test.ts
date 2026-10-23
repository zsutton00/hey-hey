import { ForbiddenException } from '@nestjs/common';
import type { TaskEventSectionSnapshot } from '../../../generated';

import { EventReplayRepairService } from '../event-replay-repair.service';

const ORGANIZATION_ID = 'org-1';
const PROJECT_ID = 'project-1';
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const REPLAY_EVENT_ID = '22222222-2222-4222-8222-222222222222';
const PAYLOAD_ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333';
const PAYLOAD_PROJECT_ID = '44444444-4444-4444-8444-444444444444';

function makeSource(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    eventType: 'task.archived',
    aggregateType: 'task',
    aggregateId: 'task-1',
    payload: {
      payloadType: 'task.archived',
      organizationId: PAYLOAD_ORGANIZATION_ID,
      projectId: PAYLOAD_PROJECT_ID,
      archivedAt: '2026-08-21T00:00:00.000Z',
    },
    headers: {},
    maxRetries: 3,
    correlationId: 'correlation-1',
    causationId: null,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    conversationId: null,
    workflowId: null,
    ...overrides,
  };
}

function makeTaskCreatedSource(
  type: string,
  sections?: TaskEventSectionSnapshot[],
) {
  return makeSource({
    eventType: 'task.created',
    payload: {
      payloadType: 'task.created',
      organizationId: PAYLOAD_ORGANIZATION_ID,
      projectId: PAYLOAD_PROJECT_ID,
      task: {
        ...(sections !== undefined ? { sections } : {}),
        name: 'Registry-backed work item',
        description: 'Preserves its exact work-item type key.',
        type,
        projectId: PAYLOAD_PROJECT_ID,
        parentTaskId: null,
        id: 'task-1',
        organizationId: PAYLOAD_ORGANIZATION_ID,
        createdAt: '2026-08-21T00:00:00.000Z',
        updatedAt: '2026-08-21T00:00:00.000Z',
      },
    },
  });
}

function setup(sources = [makeSource()]) {
  const prisma = {
    task: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    db: {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: PROJECT_ID }),
      },
      outboxEvent: {
        count: jest.fn().mockResolvedValue(sources.length),
        findMany: jest.fn().mockResolvedValue(sources),
      },
    },
  } as any;
  const publisher = {
    publishReplay: jest.fn().mockResolvedValue(REPLAY_EVENT_ID),
  } as any;

  return {
    service: new EventReplayRepairService(prisma, publisher),
    prisma,
    publisher,
  };
}

describe('EventReplayRepairService', () => {
  it.each(['CONTRACT', 'PROJECT_DEFINED_TYPE'])(
    'validates task.created with registry-backed type %s',
    async (type) => {
      const { service, publisher } = setup([makeTaskCreatedSource(type)]);

      const response = await service.execute(
        { mode: 'VALIDATE_ONLY', eventId: EVENT_ID },
        { userId: 'user-1', organizationId: ORGANIZATION_ID },
      );

      expect(response.results[0]).toEqual(
        expect.objectContaining({
          validationStatus: 'VALID',
          fixStatus: 'NOT_REQUESTED',
          queueStatus: 'NOT_REQUESTED',
          error: null,
        }),
      );
      expect(publisher.publishReplay).not.toHaveBeenCalled();
    },
  );

  it('preserves a registry-backed task type while repairing an unrelated field', async () => {
    const sections = [
      { key: 'promise', order: 0, materializedMarkdown: 'A durable promise' },
      { key: 'cleared', order: 1, materializedMarkdown: null },
    ];
    const source = makeTaskCreatedSource('CONTRACT', sections);
    delete (source.payload as Record<string, unknown>).payloadType;
    const { service, publisher } = setup([source]);

    const response = await service.execute(
      { mode: 'ATTEMPT_FIX_AND_REEMIT', eventId: EVENT_ID },
      { userId: 'user-1', organizationId: ORGANIZATION_ID },
    );

    expect(response.results[0]).toEqual(
      expect.objectContaining({
        validationStatus: 'VALID',
        fixStatus: 'APPLIED',
        queueStatus: 'QUEUED',
      }),
    );
    expect(publisher.publishReplay).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payloadType: 'task.created',
        task: expect.objectContaining({ type: 'CONTRACT', sections }),
      }),
      expect.anything(),
    );
  });

  it('validates selected events without queueing or mutating the source', async () => {
    const source = makeSource();
    const originalPayload = structuredClone(source.payload);
    const { service, publisher } = setup([source]);

    const response = await service.execute(
      { mode: 'VALIDATE_ONLY', limit: 25 },
      { userId: 'user-1', organizationId: ORGANIZATION_ID },
    );

    expect(response).toEqual({
      total: 1,
      truncated: false,
      results: [
        expect.objectContaining({
          originalEventId: EVENT_ID,
          replayEventId: null,
          eventType: 'task.archived',
          validationStatus: 'VALID',
          fixStatus: 'NOT_REQUESTED',
          queueStatus: 'NOT_REQUESTED',
          error: null,
        }),
      ],
    });
    expect(publisher.publishReplay).not.toHaveBeenCalled();
    expect(source.payload).toEqual(originalPayload);
  });

  it('selects the requested page with the configured page size', async () => {
    const { service, prisma } = setup();
    prisma.db.outboxEvent.count.mockResolvedValue(250);

    const response = await service.execute(
      { mode: 'VALIDATE_ONLY', limit: 100, page: 2 },
      { userId: 'user-1', organizationId: ORGANIZATION_ID },
    );

    expect(prisma.db.outboxEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100, take: 100 }),
    );
    expect(response.truncated).toBe(true);
  });

  it('re-emits a valid event through the publisher with replay metadata', async () => {
    const { service, publisher } = setup();

    const response = await service.execute(
      { mode: 'REEMIT_ORIGINAL', eventId: EVENT_ID },
      { userId: 'user-1', organizationId: ORGANIZATION_ID },
    );

    expect(publisher.publishReplay).toHaveBeenCalledWith(
      expect.objectContaining({ id: EVENT_ID }),
      expect.objectContaining({ payloadType: 'task.archived' }),
      {
        replayMode: 'REEMIT_ORIGINAL',
        replayedByUserId: 'user-1',
      },
    );
    expect(response.results[0]).toEqual(
      expect.objectContaining({
        validationStatus: 'VALID',
        queueStatus: 'QUEUED',
        replayEventId: REPLAY_EVENT_ID,
      }),
    );
  });

  it('repairs invalid payloads, validates the repaired copy, and preserves the source', async () => {
    const source = makeSource({
      payload: {
        organizationId: PAYLOAD_ORGANIZATION_ID,
        projectId: PAYLOAD_PROJECT_ID,
        archivedAt: '2026-08-21T00:00:00.000Z',
      },
    });
    const originalPayload = structuredClone(source.payload);
    const { service, publisher } = setup([source]);

    const response = await service.execute(
      { mode: 'ATTEMPT_FIX_AND_REEMIT' },
      { userId: 'user-1', organizationId: ORGANIZATION_ID },
    );

    expect(response.results[0]).toEqual(
      expect.objectContaining({
        validationStatus: 'VALID',
        fixStatus: 'APPLIED',
        queueStatus: 'QUEUED',
      }),
    );
    expect(publisher.publishReplay).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ payloadType: 'task.archived' }),
      expect.anything(),
    );
    expect(source.payload).toEqual(originalPayload);
  });

  it('rejects a project outside the caller organization before selecting events', async () => {
    const { service, prisma } = setup();
    prisma.db.project.findFirst.mockResolvedValue(null);

    await expect(
      service.execute(
        { mode: 'VALIDATE_ONLY', projectId: PROJECT_ID },
        { userId: 'user-1', organizationId: ORGANIZATION_ID },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.db.outboxEvent.findMany).not.toHaveBeenCalled();
  });

  it('returns an explicit per-event failure for an unmapped event type', async () => {
    const { service, publisher } = setup([
      makeSource({ eventType: 'unknown.event' }),
    ]);

    const response = await service.execute(
      { mode: 'ATTEMPT_FIX_AND_REEMIT' },
      { userId: 'user-1', organizationId: ORGANIZATION_ID },
    );

    expect(response.results[0]).toEqual(
      expect.objectContaining({
        validationStatus: 'INVALID',
        fixStatus: 'FAILED',
        queueStatus: 'NOT_REQUESTED',
        replayEventId: null,
      }),
    );
    expect(publisher.publishReplay).not.toHaveBeenCalled();
  });

  it('returns a per-event failure when a repair routine throws', async () => {
    const { service, publisher } = setup([
      makeSource({
        eventType: 'plan_step_relationship.created',
        payload: {},
      }),
    ]);

    const response = await service.execute(
      { mode: 'ATTEMPT_FIX_AND_REEMIT' },
      { userId: 'user-1', organizationId: ORGANIZATION_ID },
    );

    expect(response.results[0]).toEqual(
      expect.objectContaining({
        originalEventId: EVENT_ID,
        validationStatus: 'INVALID',
        fixStatus: 'FAILED',
        queueStatus: 'NOT_REQUESTED',
        replayEventId: null,
      }),
    );
    expect(response.results[0]?.error).toEqual(expect.any(String));
    expect(publisher.publishReplay).not.toHaveBeenCalled();
  });
});
