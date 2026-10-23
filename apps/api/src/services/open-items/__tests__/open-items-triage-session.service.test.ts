import { BadRequestException } from '@nestjs/common';
import { WorkflowName } from '../../../generated';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { OrganizationId, ProjectId, UserId } from '../../../types';
import type { AgentSessionService } from '../../agent-session.service';
import {
  OPEN_ITEMS_TRIAGE_SESSION_TITLE,
  OpenItemsTriageSessionService,
} from '../open-items-triage-session.service';

const scope = {
  organizationId: 'org-1' as OrganizationId,
  projectId: '11111111-1111-4111-8111-111111111111' as ProjectId,
  userId: 'user-1' as UserId,
};

function build() {
  const tx = {};
  const prisma = {
    db: {
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    },
  } as unknown as PrismaService;
  let sessionCount = 0;
  let conversationCount = 0;
  const agentSessions = {
    createInTransaction: jest.fn(() =>
      Promise.resolve({ id: `session-${++sessionCount}` }),
    ),
    createConversationForSession: jest.fn(() =>
      Promise.resolve({
        conversation: { id: `conversation-${++conversationCount}` },
      }),
    ),
  };
  const service = new OpenItemsTriageSessionService(
    prisma,
    agentSessions as unknown as AgentSessionService,
  );
  return { service, tx, agentSessions };
}

describe('OpenItemsTriageSessionService', () => {
  it('creates a NOT_STARTED PROJECT_CONVERSATION session and binds a triage conversation', async () => {
    const { service, tx, agentSessions } = build();

    const result = await service.create(scope);

    expect(result).toEqual({
      agentSessionId: 'session-1',
      conversationId: 'conversation-1',
      created: true,
    });
    expect(agentSessions.createInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        organization: { connect: { id: scope.organizationId } },
        project: { connect: { id: scope.projectId } },
        user: { connect: { id: scope.userId } },
        status: 'NOT_STARTED',
        type: 'PROJECT_CONVERSATION',
        title: OPEN_ITEMS_TRIAGE_SESSION_TITLE,
      }),
      scope.organizationId,
    );
    expect(agentSessions.createConversationForSession).toHaveBeenCalledWith(
      scope.organizationId,
      scope.projectId,
      'session-1',
      { workflowType: WorkflowName.OpenItemsTriage },
    );
  });

  it('creates a distinct session and conversation for every run', async () => {
    const { service, agentSessions } = build();

    const first = await service.create(scope);
    const second = await service.create(scope);

    expect(second.agentSessionId).not.toBe(first.agentSessionId);
    expect(second.conversationId).not.toBe(first.conversationId);
    expect(agentSessions.createInTransaction).toHaveBeenCalledTimes(2);
  });

  it('surfaces conversation attach failures', async () => {
    const { service, agentSessions } = build();
    agentSessions.createConversationForSession.mockRejectedValue(
      new BadRequestException('Agent session not found in this project'),
    );

    await expect(service.create(scope)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
