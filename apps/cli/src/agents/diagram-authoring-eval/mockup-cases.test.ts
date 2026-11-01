import { describe, expect, it } from 'vitest';
import { matchesMockupCase, mockupCases } from './mockup-cases';

describe('Mockup authoring evaluation', () => {
  it.each(mockupCases)('checks authored target fields for $name', (scenario) => {
    const metadata = {
      key: 'diagramElementMetadata',
      content: {
        canonicalReference:
          scenario.relation === 'reference'
            ? { entityType: 'TASK', entityId: scenario.target }
            : null,
      },
    };
    const edges =
      scenario.relation === 'link'
        ? [{ edgeType: 'RELATED_TO', targetEntityType: 'TASK', targetEntityId: scenario.target }]
        : scenario.relation === 'proposal'
          ? [
              {
                edgeType: 'RELATED_TO',
                targetEntityType: 'PROPOSAL',
                targetEntityId: scenario.target,
              },
            ]
          : [];
    expect(matchesMockupCase(scenario, { sections: [metadata], edges })).toBe(true);
    expect(
      matchesMockupCase(scenario, {
        sections: [metadata],
        edges: [
          { edgeType: 'RELATED_TO', targetEntityType: 'TASK', targetEntityId: 'wrong-target' },
        ],
      }),
    ).toBe(false);
  });
});
