import { prismaMessageResultToResponseDto } from '../message.mapper';
import { MessageQueryResult, ResolvedUser } from '../../services/types';
import { Proposal } from '@prisma/client';

const BASE_MESSAGE: MessageQueryResult = {
  id: 'message-root',
  projectId: 'project-1' as any,
  status: 'open',
  userId: 'user-1',
  data: { comment: 'hello' },
  conversationId: 'conversation-1' as any,
  parentMessageId: null,
  createdAt: new Date('2026-03-10T00:00:00.000Z'),
  type: 'USER',
};

const PROPOSAL_FIXTURE: Proposal = {
  id: 'proposal-1',
  organizationId: 'org-1',
  projectId: 'project-1',
  type: 'EDIT_TASK',
  action: 'PROPOSE',
  status: 'PROPOSED',
  targetEntityId: 'task-1',
  targetEntityType: 'TASK',
  title: 'Update task',
  updates: { title: 'New title' } as any,
  requestorId: 'user-1',
  requestorContext: null,
  influences: null,
  conversationId: 'conversation-1',
  messageId: 'message-root',
  validationSessionId: null,
  createdAt: new Date('2026-03-10T00:00:00.000Z'),
  updatedAt: new Date('2026-03-10T00:00:00.000Z'),
  resolvedAt: null,
} as unknown as Proposal;

const RESOLVED_USER: ResolvedUser = {
  id: 'user-1',
  email: 'zac@example.com',
  name: 'Zac Sutton',
  isActive: true,
  lastLoginAt: new Date('2026-03-09T12:00:00.000Z'),
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-03-09T12:00:00.000Z'),
};

describe('prismaMessageResultToResponseDto', () => {
  it('keeps unconfirmed delivery out of the visible queue until the owner confirms waiting', () => {
    const submitted: MessageQueryResult = {
      ...BASE_MESSAGE,
      executionStatus: 'queued',
      executionAdmissionId: null,
    };
    expect(
      prismaMessageResultToResponseDto(submitted).executionQueueConfirmed,
    ).toBe(false);
    const waiting: MessageQueryResult = {
      ...submitted,
      executionAdmissionId: 'c17d2ed5-cd1b-4765-bd65-50f78504724b',
    };
    expect(
      prismaMessageResultToResponseDto(waiting).executionQueueConfirmed,
    ).toBe(true);
    expect(
      prismaMessageResultToResponseDto({
        ...waiting,
        executionStatus: 'started',
      }).executionQueueConfirmed,
    ).toBe(false);
    expect(prismaMessageResultToResponseDto(BASE_MESSAGE)).not.toHaveProperty(
      'executionQueueConfirmed',
    );
  });
  it('reports the recorded admission disposition and derives confirmed waiting from it', () => {
    const queued: MessageQueryResult = {
      ...BASE_MESSAGE,
      executionStatus: 'queued',
      executionAdmissionId: null,
      executionAdmissionDisposition: null,
    };
    const pending = prismaMessageResultToResponseDto(queued);
    expect(pending.executionAdmissionDisposition).toBe('PENDING');
    expect(pending.executionQueueConfirmed).toBe(false);

    const immediate = prismaMessageResultToResponseDto({
      ...queued,
      executionAdmissionDisposition: 'IMMEDIATE',
    });
    expect(immediate.executionAdmissionDisposition).toBe('IMMEDIATE');
    expect(immediate.executionQueueConfirmed).toBe(false);

    const waiting = prismaMessageResultToResponseDto({
      ...queued,
      executionAdmissionDisposition: 'QUEUED',
    });
    expect(waiting.executionAdmissionDisposition).toBe('QUEUED');
    expect(waiting.executionQueueConfirmed).toBe(true);

    const started = prismaMessageResultToResponseDto({
      ...queued,
      executionStatus: 'started',
      executionAdmissionDisposition: 'IMMEDIATE',
    });
    expect(started.executionAdmissionDisposition).toBe('IMMEDIATE');
    expect(started.executionQueueConfirmed).toBe(false);

    expect(prismaMessageResultToResponseDto(BASE_MESSAGE)).not.toHaveProperty(
      'executionAdmissionDisposition',
    );
  });
  it('uses the conversation workflowId for nested responses', () => {
    const createdAt = new Date('2026-03-10T00:00:00.000Z');
    const result: MessageQueryResult = {
      id: 'message-root',
      projectId: 'project-1' as any,
      status: 'open',
      userId: 'user-1',
      data: { question: 'root' },
      conversationId: 'conversation-1' as any,
      parentMessageId: null,
      createdAt,
      type: 'USER',
      conversation: { workflowId: 'workflow-1' as any },
      responses: [
        {
          id: 'message-child',
          projectId: 'project-1' as any,
          status: 'open',
          userId: 'system',
          data: {
            type: 'QUESTIONS',
            nodeId: 'node-1',
            response: 'child',
            detectedIntent: '',
            intentConfidence: 0,
            uiElements: [],
          },
          conversationId: 'conversation-1' as any,
          parentMessageId: 'message-root' as any,
          createdAt,
          type: 'SYSTEM',
        },
      ],
    };

    const mapped = prismaMessageResultToResponseDto(result);

    expect(mapped.responses).toHaveLength(1);
    expect(mapped.responses?.[0]?.id).toBe('message-child');
  });

  describe('user field on USER messages', () => {
    it('populates user when resolved user is present', () => {
      const result: MessageQueryResult = {
        ...BASE_MESSAGE,
        user: RESOLVED_USER,
      };

      const mapped = prismaMessageResultToResponseDto(result);

      expect(mapped.type).toBe('USER');
      const userMsg = mapped as any;
      expect(userMsg.user).toEqual({
        id: 'user-1',
        email: 'zac@example.com',
        name: 'Zac Sutton',
        isActive: true,
        lastLoginAt: '2026-03-09T12:00:00.000Z',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2026-03-09T12:00:00.000Z',
        currentOrganizationId: null,
      });
    });

    it('omits user when user is null (deleted/missing user)', () => {
      const result: MessageQueryResult = { ...BASE_MESSAGE, user: null };

      const mapped = prismaMessageResultToResponseDto(result) as any;

      expect(mapped.user).toBeUndefined();
    });

    it('omits user when user field is not set', () => {
      const result: MessageQueryResult = { ...BASE_MESSAGE };

      const mapped = prismaMessageResultToResponseDto(result) as any;

      expect(mapped.user).toBeUndefined();
    });

    it('handles null lastLoginAt gracefully', () => {
      const result: MessageQueryResult = {
        ...BASE_MESSAGE,
        user: { ...RESOLVED_USER, lastLoginAt: null },
      };

      const mapped = prismaMessageResultToResponseDto(result) as any;

      expect(mapped.user.lastLoginAt).toBeNull();
    });
  });

  describe('user field on SYSTEM messages', () => {
    it('does not include a user field for system messages', () => {
      const result: MessageQueryResult = {
        ...BASE_MESSAGE,
        type: 'SYSTEM',
        userId: 'system',
        data: {
          type: 'NOOP',
          detectedIntent: '',
          intentConfidence: 0,
          response: '',
        },
        user: RESOLVED_USER, // should be ignored
      };

      const mapped = prismaMessageResultToResponseDto(result) as any;

      expect(mapped.type).toBe('SYSTEM');
      expect(mapped.user).toBeUndefined();
    });
  });

  describe('proposals gating by message status', () => {
    const PROPOSAL_DTOS = new Map([
      [
        PROPOSAL_FIXTURE.id,
        {
          ...PROPOSAL_FIXTURE,
          requiredApprovals: 2,
          approvals: [],
          createdAt: PROPOSAL_FIXTURE.createdAt.toISOString(),
          updatedAt: PROPOSAL_FIXTURE.updatedAt.toISOString(),
        } as any,
      ],
    ]);
    const SYSTEM_DATA = {
      type: 'NOOP' as const,
      detectedIntent: '',
      intentConfidence: 0,
      response: '',
    };

    describe('SYSTEM messages', () => {
      it('attaches proposals when status is completed', () => {
        const result: MessageQueryResult = {
          ...BASE_MESSAGE,
          type: 'SYSTEM',
          userId: 'system',
          data: SYSTEM_DATA,
          status: 'completed',
          proposals: [PROPOSAL_FIXTURE],
        };

        const mapped = prismaMessageResultToResponseDto(
          result,
          undefined,
          PROPOSAL_DTOS,
        ) as any;

        expect(mapped.proposals).toHaveLength(1);
        expect(mapped.proposals[0].id).toBe('proposal-1');
      });

      it.each(['open', 'system_processing', 'streaming_ready', 'failed'])(
        'omits proposals when status is %s',
        (status) => {
          const result: MessageQueryResult = {
            ...BASE_MESSAGE,
            type: 'SYSTEM',
            userId: 'system',
            data: SYSTEM_DATA,
            status,
            proposals: [PROPOSAL_FIXTURE],
          };

          const mapped = prismaMessageResultToResponseDto(result) as any;

          expect(mapped.proposals).toBeUndefined();
        },
      );
    });

    describe('USER messages', () => {
      it('attaches proposals when status is completed', () => {
        const result: MessageQueryResult = {
          ...BASE_MESSAGE,
          status: 'completed',
          proposals: [PROPOSAL_FIXTURE],
        };

        const mapped = prismaMessageResultToResponseDto(
          result,
          undefined,
          PROPOSAL_DTOS,
        ) as any;

        expect(mapped.proposals).toHaveLength(1);
        expect(mapped.proposals[0].id).toBe('proposal-1');
      });

      it.each(['open', 'system_processing', 'streaming_ready', 'failed'])(
        'omits proposals when status is %s',
        (status) => {
          const result: MessageQueryResult = {
            ...BASE_MESSAGE,
            status,
            proposals: [PROPOSAL_FIXTURE],
          };

          const mapped = prismaMessageResultToResponseDto(result) as any;

          expect(mapped.proposals).toBeUndefined();
        },
      );
    });
  });
});
