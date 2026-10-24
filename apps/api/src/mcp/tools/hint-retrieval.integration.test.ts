import type { Request } from 'express';
import { ForbiddenException } from '@nestjs/common';
import { HintReadToolsProvider } from './hint-tools.provider';
import { HintService } from '../../services/hints/hint.service';
import type { Hint } from '../../generated/graphs';
import { testIds } from '../../utils/testUtils';

const itemId = '11111111-1111-4111-8111-111111111111';
const hiddenId = '22222222-2222-4222-8222-222222222222';
const hint: Hint = {
  id: '33333333-3333-4333-8333-333333333333',
  projectId: testIds.project,
  text: 'Preserve graph connections during review.',
  origin: {
    entityType: 'AGENT_SESSION',
    entityId: '44444444-4444-4444-8444-444444444444',
  },
  createdAt: '2026-10-24T00:00:00Z',
  updatedAt: '2026-10-24T00:00:00Z',
  connections: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      targetNodeId: itemId,
      targetEntityType: 'TASK',
      strength: 2.5,
      createdAt: '2026-10-24T00:00:00Z',
      updatedAt: '2026-10-24T00:00:00Z',
    },
  ],
};
const request = {
  user: { userId: testIds.user, currentOrgId: testIds.organization },
  headers: { authorization: 'Bearer token', 'x-project-id': testIds.project },
} as unknown as Request;
function setup(enabled: boolean) {
  const graph = {
    findHintsByConnectedItems: jest.fn().mockResolvedValue({ hints: [hint] }),
    listProjectHints: jest.fn(),
  };
  const access = {
    assertResource: jest.fn(
      async (_u: string, _o: string, _kind: string, id: string) => {
        if (id === hiddenId) throw new ForbiddenException('hidden');
      },
    ),
  };
  return {
    provider: new HintReadToolsProvider(
      new HintService({ enabled }, graph as never, access as never),
    ),
    graph,
  };
}
describe('MCP connected-Hint retrieval through HintService', () => {
  it('returns text and strengths without calling the Admin listing', async () => {
    const { provider, graph } = setup(true);
    expect(
      await provider.getHintsForItems(
        { itemIds: [itemId] },
        {} as never,
        request,
      ),
    ).toMatchObject({
      hints: [
        {
          text: hint.text,
          connections: [{ targetNodeId: itemId, strength: 2.5 }],
        },
      ],
    });
    expect(graph.findHintsByConnectedItems).toHaveBeenCalledWith(
      testIds.organization,
      testIds.project,
      { nodeIds: [itemId] },
      'token',
    );
    expect(graph.listProjectHints).not.toHaveBeenCalled();
  });
  it('returns nothing and never calls the graph when disabled', async () => {
    const { provider, graph } = setup(false);
    await expect(
      provider.getHintsForItems({ itemIds: [itemId] }, {} as never, request),
    ).resolves.toEqual({ hints: [] });
    expect(graph.findHintsByConnectedItems).not.toHaveBeenCalled();
  });
  it('withholds the whole hint if another connected item is inaccessible', async () => {
    const { provider, graph } = setup(true);
    graph.findHintsByConnectedItems.mockResolvedValue({
      hints: [
        {
          ...hint,
          connections: [
            ...hint.connections,
            { ...hint.connections[0], targetNodeId: hiddenId },
          ],
        },
      ],
    });
    await expect(
      provider.getHintsForItems({ itemIds: [itemId] }, {} as never, request),
    ).resolves.toEqual({ hints: [] });
  });
});
