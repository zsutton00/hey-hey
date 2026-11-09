import { ForbiddenException } from '@nestjs/common';
import { HintService } from './hint.service';
import type { Hint } from '../../generated/graphs';
import type { OrganizationId, ProjectId } from '../../types';

const requestor = {
  userId: 'user-1',
  organizationId: 'org-1' as OrganizationId,
  projectId: 'project-1' as ProjectId,
  token: 'token',
};

const visibleTask = '11111111-1111-4111-8111-111111111111';
const hiddenTask = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';

const makeHint = (id: string, targets: string[]): Hint => ({
  id,
  projectId: requestor.projectId,
  text: `hint ${id}`,
  origin: { entityType: 'AGENT_SESSION', entityId: sessionId },
  connections: targets.map((targetNodeId, index) => ({
    id: `${id}-c${index}`,
    targetNodeId,
    targetEntityType: 'TASK',
    strength: 1,
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
  })),
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
});

function setup() {
  const graphsClient = {
    listProjectHints: jest.fn(),
    createHint: jest.fn(),
    addHintConnection: jest.fn(),
    getHint: jest.fn(),
    retireHint: jest.fn(),
    updateHintText: jest.fn(),
    findHintsByConnectedItems: jest.fn(),
  };
  const resourceAccess = {
    assertResource: jest.fn(
      async (_u: string, _o: string, _kind: string, id: string) => {
        if (id === hiddenTask) throw new ForbiddenException('hidden');
      },
    ),
  };
  const service = new HintService(
    graphsClient as never,
    resourceAccess as never,
  );
  return { service, graphsClient, resourceAccess };
}

describe('HintService', () => {
  it('drops any hint connected to an item the caller cannot see', async () => {
    const { service, graphsClient } = setup();
    graphsClient.findHintsByConnectedItems.mockResolvedValue({
      hints: [
        makeHint('visible', [visibleTask]),
        makeHint('leaky', [visibleTask, hiddenTask]),
      ],
    });

    const hints = await service.findHintsForItems(requestor, [visibleTask]);

    expect(hints.map((h) => h.id)).toEqual(['visible']);
    expect(graphsClient.findHintsByConnectedItems).toHaveBeenCalledWith(
      requestor.organizationId,
      requestor.projectId,
      { nodeIds: [visibleTask] },
      requestor.token,
    );
  });

  it('requires at least one connection to create a hint', async () => {
    const { service, graphsClient } = setup();

    await expect(
      service.createHint(requestor, {
        text: 'x',
        origin: { entityType: 'AGENT_SESSION', entityId: sessionId },
        connections: [],
      }),
    ).rejects.toThrow('between 1 and 20 connections');
    expect(graphsClient.createHint).not.toHaveBeenCalled();
  });

  it('refuses to connect a new hint to an item the caller cannot see', async () => {
    const { service, graphsClient } = setup();

    await expect(
      service.createHint(requestor, {
        text: 'x',
        origin: { entityType: 'AGENT_SESSION', entityId: sessionId },
        connections: [
          { targetNodeId: hiddenTask, targetEntityType: 'TASK', strength: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(graphsClient.createHint).not.toHaveBeenCalled();
  });

  it('creates a hint once its origin and items are visible', async () => {
    const { service, graphsClient, resourceAccess } = setup();
    graphsClient.createHint.mockResolvedValue(makeHint('h1', [visibleTask]));

    const hint = await service.createHint(requestor, {
      text: 'hint h1',
      origin: { entityType: 'AGENT_SESSION', entityId: sessionId },
      connections: [
        { targetNodeId: visibleTask, targetEntityType: 'TASK', strength: 1 },
      ],
    });

    expect(hint.id).toBe('h1');
    expect(resourceAccess.assertResource).toHaveBeenCalledWith(
      requestor.userId,
      requestor.organizationId,
      'agentSession',
      sessionId,
      requestor.projectId,
    );
  });

  it('refuses to add a connection to a hint the caller cannot fully see', async () => {
    const { service, graphsClient } = setup();
    graphsClient.getHint.mockResolvedValue(makeHint('h1', [hiddenTask]));

    await expect(
      service.addConnection(requestor, 'h1', {
        targetNodeId: visibleTask,
        targetEntityType: 'TASK',
        strength: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(graphsClient.addHintConnection).not.toHaveBeenCalled();
  });

  it('retires a hint whose connected items are all visible', async () => {
    const { service, graphsClient } = setup();
    graphsClient.getHint.mockResolvedValue(makeHint('h1', [visibleTask]));
    await service.retireHint(requestor, 'h1');
    expect(graphsClient.retireHint).toHaveBeenCalledWith(
      requestor.organizationId,
      requestor.projectId,
      'h1',
      requestor.token,
    );
  });

  it('refuses to retire a hint connected to an item the caller cannot see', async () => {
    const { service, graphsClient } = setup();
    graphsClient.getHint.mockResolvedValue(
      makeHint('h1', [visibleTask, hiddenTask]),
    );
    await expect(service.retireHint(requestor, 'h1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(graphsClient.retireHint).not.toHaveBeenCalled();
  });

  it('corrects the text of a hint whose connected items are all visible', async () => {
    const { service, graphsClient } = setup();
    const hint = makeHint('h1', [visibleTask]);
    graphsClient.getHint.mockResolvedValue(hint);
    graphsClient.updateHintText.mockResolvedValue({ ...hint, text: 'fixed' });
    const view = await service.updateHintText(requestor, 'h1', 'fixed');
    expect(graphsClient.updateHintText).toHaveBeenCalledWith(
      'org-1',
      'project-1',
      'h1',
      'fixed',
      'token',
    );
    expect(view.text).toBe('fixed');
    expect(view.connections).toHaveLength(1);
    expect(view.origin.entityId).toBe(sessionId);
  });

  it('refuses to correct a hint connected to an item the caller cannot see', async () => {
    const { service, graphsClient } = setup();
    graphsClient.getHint.mockResolvedValue(
      makeHint('h1', [visibleTask, hiddenTask]),
    );
    await expect(
      service.updateHintText(requestor, 'h1', 'fixed'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(graphsClient.updateHintText).not.toHaveBeenCalled();
  });

  it('lets graph errors surface', async () => {
    const { service, graphsClient } = setup();
    graphsClient.findHintsByConnectedItems.mockRejectedValue(
      new Error('graph down'),
    );

    await expect(
      service.findHintsForItems(requestor, [visibleTask]),
    ).rejects.toThrow('graph down');
  });
});
