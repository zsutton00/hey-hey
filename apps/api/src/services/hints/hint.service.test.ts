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
  it('lists the project without using connected-item queries', async () => {
    const { service, graphsClient, resourceAccess } = setup();
    const response = { hints: [makeHint('admin', [visibleTask])] };
    graphsClient.listProjectHints.mockResolvedValue(response);
    await expect(service.listProjectHints(requestor)).resolves.toEqual(
      response,
    );
    expect(graphsClient.listProjectHints).toHaveBeenCalledWith(
      requestor.organizationId,
      requestor.projectId,
      requestor.token,
    );
    expect(resourceAccess.assertResource).toHaveBeenCalledWith(
      requestor.userId,
      requestor.organizationId,
      'project',
      requestor.projectId,
    );
    expect(graphsClient.findHintsByConnectedItems).not.toHaveBeenCalled();
  });

  it('refuses the project listing before querying the graph when project access fails', async () => {
    const { service, graphsClient, resourceAccess } = setup();
    resourceAccess.assertResource.mockRejectedValueOnce(
      new ForbiddenException('hidden project'),
    );
    await expect(service.listProjectHints(requestor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(graphsClient.listProjectHints).not.toHaveBeenCalled();
  });

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
