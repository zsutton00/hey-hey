import type {
  ContextRelatedEntityDto,
  FeatureHierarchyEntryDto,
} from '@hey-hey/contracts/api/models';
import { REQUIREMENT_CITATION_EDGE_REASONING } from '../../tasks/feature-requirement-citation-edges';
import {
  groupFeatureHierarchy,
  groupRelatedEntities,
} from '../related-entity-grouping';
import {
  MCP_RELATED_ENTITY_SELECTION,
  selectRelatedEntities,
} from '../related-entity-selection';

function row(
  entityId: string,
  relationship: string,
  extra: Partial<ContextRelatedEntityDto> = {},
): ContextRelatedEntityDto {
  return {
    entityId,
    entityType: 'TASK',
    displayName: entityId,
    relationship,
    source: 'system',
    ...extra,
  } as ContextRelatedEntityDto;
}

function feature(
  extra: Partial<FeatureHierarchyEntryDto>,
): FeatureHierarchyEntryDto {
  return {
    id: 'feature-1',
    name: 'Agent Context & Tools',
    relationshipType: 'DEPENDS_ON',
    direction: 'outbound',
    ...extra,
  } as FeatureHierarchyEntryDto;
}

describe('groupRelatedEntities', () => {
  it('lists an entity linked two ways once, without the stock citation reason', () => {
    const grouped = groupRelatedEntities([
      row('a', 'depends-on', {
        reasoning: REQUIREMENT_CITATION_EDGE_REASONING,
      }),
      row('a', 'mentions'),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.relationships).toEqual([
      { relationship: 'depends-on' },
      { relationship: 'mentions' },
    ]);
  });

  it('keeps both directions of a mention on one entry', () => {
    const [entry] = groupRelatedEntities([
      row('a', 'mentioned-by'),
      row('a', 'mentions'),
    ]);

    expect(entry?.relationships.map((r) => r.relationship)).toEqual([
      'mentioned-by',
      'mentions',
    ]);
  });

  it('keeps a written reason and the source needed to tell origins apart', () => {
    const [entry] = groupRelatedEntities([
      row('a', 'related-to', {
        source: 'agent',
        reasoning: 'Owns canonical status.',
      }),
      row('a', 'mentioned-by'),
    ]);

    expect(entry?.relationships).toEqual([
      { relationship: 'mentioned-by', source: 'system' },
      {
        relationship: 'related-to',
        source: 'agent',
        reasoning: 'Owns canonical status.',
      },
    ]);
  });

  it('keeps the selected entities, their order and the counts unchanged', () => {
    const rows = [
      ...Array.from({ length: 120 }, (_, i) =>
        row(`e${String(i).padStart(3, '0')}`, 'mentions'),
      ),
      row('e005', 'mentioned-by'),
    ];
    const selection = selectRelatedEntities(
      rows,
      MCP_RELATED_ENTITY_SELECTION,
      0,
    );

    const grouped = groupRelatedEntities(selection.relatedEntities);

    expect(grouped.map((e) => e.entityId)).toEqual([
      ...new Set(selection.relatedEntities.map((r) => r.entityId)),
    ]);
    expect(grouped).toHaveLength(100);
    expect(selection.candidateEntityCount).toBe(120);
    expect(selection.omittedEntityCount).toBe(20);
  });
});

describe('groupFeatureHierarchy', () => {
  it('collapses repeated outbound edges, preferring the written reason', () => {
    const grouped = groupFeatureHierarchy([
      feature({ reasoning: REQUIREMENT_CITATION_EDGE_REASONING }),
      feature({ reasoning: 'Needs its context shape.' }),
    ]);

    expect(grouped).toEqual([
      feature({ reasoning: 'Needs its context shape.' }),
    ]);
  });

  it('skips empty reasons and keeps every distinct written reason', () => {
    const [entry] = groupFeatureHierarchy([
      feature({ reasoning: '' }),
      feature({ reasoning: 'Needs its context shape.' }),
      feature({ reasoning: 'Also owns the MCP surface.' }),
      feature({ reasoning: 'Needs its context shape.' }),
    ]);

    expect(entry?.reasoning).toBe(
      'Needs its context shape.\nAlso owns the MCP surface.',
    );
  });

  it('attributes a merged entry to the origin of its written reason', () => {
    const [entry] = groupFeatureHierarchy([
      feature({
        source: 'system',
        reasoning: REQUIREMENT_CITATION_EDGE_REASONING,
      }),
      feature({ source: 'agent', reasoning: 'Needs its context shape.' }),
    ]);

    expect(entry?.source).toBe('agent');
  });

  it('leaves the origin off when the merged entries disagree and none has a reason', () => {
    const [entry] = groupFeatureHierarchy([
      feature({ source: 'system' }),
      feature({ source: 'agent' }),
    ]);

    expect(entry?.source).toBeUndefined();
  });

  it('drops a lone stock reason and keeps inbound separate from outbound', () => {
    const grouped = groupFeatureHierarchy([
      feature({ reasoning: REQUIREMENT_CITATION_EDGE_REASONING }),
      feature({ direction: 'inbound', reasoning: 'Consumes it.' }),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.reasoning).toBeUndefined();
    expect(grouped[1]?.reasoning).toBe('Consumes it.');
  });
});
