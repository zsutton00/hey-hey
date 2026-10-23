import { PlanDesignDocLinksService } from '../plan-design-doc-links.service';
import { OrganizationId, ProjectId } from '../../../types';

describe('PlanDesignDocLinksService', () => {
  const migrated = {
    sourceNodeId: 'plan',
    sourceEntityType: 'TASK',
    targetNodeId: 'feature-owned-doc',
    targetEntityType: 'DESIGN_DOC',
    type: 'DERIVES_FROM',
    reasoning: 'Preserved legacy LINKED Plan relationship legacy-id.',
  };
  const edges = { findIncident: jest.fn() };
  const service = new PlanDesignDocLinksService(edges as never, () => 'token');
  const resolve = () =>
    service.resolve('org' as OrganizationId, 'project' as ProjectId, 'plan');

  it('recovers the migrated Plan link independently of document ownership', async () => {
    edges.findIncident.mockResolvedValue([migrated]);
    await expect(resolve()).resolves.toEqual(['feature-owned-doc']);
    expect(edges.findIncident).toHaveBeenLastCalledWith(
      'org',
      'project',
      {
        nodeIds: new Set(['plan']),
        types: new Set(['DERIVES_FROM']),
      },
      'token',
    );
  });

  it('prefers explicit derivation over preserved legacy links', async () => {
    edges.findIncident.mockResolvedValue([
      { ...migrated, type: 'RELATED_TO' },
      { ...migrated, type: 'DERIVES_FROM', targetNodeId: 'new-seed' },
    ]);
    await expect(resolve()).resolves.toEqual(['new-seed']);
  });

  it('excludes arbitrary related documents, incoming links, and other endpoint types', async () => {
    edges.findIncident.mockResolvedValue([
      { ...migrated, type: 'RELATED_TO', reasoning: 'Related context' },
      { ...migrated, sourceNodeId: 'another-plan' },
      { ...migrated, targetEntityType: 'TASK' },
      { ...migrated, sourceEntityType: 'DESIGN_DOC' },
    ]);
    await expect(resolve()).resolves.toEqual([]);
  });

  it('surfaces graph failures rather than reporting a missing document', async () => {
    edges.findIncident.mockRejectedValue(new Error('Graph unavailable'));
    await expect(resolve()).rejects.toThrow('Graph unavailable');
  });
});
