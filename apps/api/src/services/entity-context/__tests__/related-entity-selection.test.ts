import type { ContextRelatedEntityDto } from '@hey-hey/contracts/api/models';
import {
  MCP_RELATED_ENTITY_SELECTION,
  selectRelatedEntities,
} from '../related-entity-selection';

function row(
  entityId: string,
  relationship: string,
  source: 'agent' | 'system' = 'system',
  displayName = entityId,
): ContextRelatedEntityDto {
  return {
    entityId,
    entityType: 'TASK',
    displayName,
    relationship,
    source,
  } as ContextRelatedEntityDto;
}

describe('selectRelatedEntities', () => {
  it('ranks authored, then other direct, then pivot-only neighbors', () => {
    const rows = [
      row('sibling', 'sibling-via-parent'),
      row('mention', 'mentions'),
      row('authored', 'depends-on', 'agent'),
    ];

    const { relatedEntities } = selectRelatedEntities(
      rows,
      { maxEntities: 3 },
      0,
    );

    expect(relatedEntities.map((entry) => entry.entityId)).toEqual([
      'authored',
      'mention',
      'sibling',
    ]);
  });

  it('lets repeated routes strengthen one entity without using extra slots', () => {
    const rows = [
      row('a', 'mentions'),
      row('b', 'mentions'),
      row('b', 'mentioned-by'),
      row('b', 'tracks'),
    ];

    const result = selectRelatedEntities(rows, { maxEntities: 1 }, 0);

    expect(result.relatedEntities.map((entry) => entry.relationship)).toEqual([
      'mentions',
      'mentioned-by',
      'tracks',
    ]);
    expect(new Set(result.relatedEntities.map((e) => e.entityId))).toEqual(
      new Set(['b']),
    );
    expect(result.omittedEntityCount).toBe(1);
  });

  it('never lets route count lift a pivot-only neighbor above a direct one', () => {
    const rows = [
      row('direct', 'mentions'),
      ...Array.from({ length: 40 }, () => row('sibling', 'sibling-via-parent')),
    ];

    const { relatedEntities } = selectRelatedEntities(
      rows,
      { maxEntities: 2 },
      0,
    );

    expect(relatedEntities[0]?.entityId).toBe('direct');
  });

  it('caps at the MCP limit and discloses exact candidate and omitted counts', () => {
    const limit = MCP_RELATED_ENTITY_SELECTION.maxEntities;
    const rows = Array.from({ length: limit + 25 }, (_, index) =>
      row(`e-${String(index).padStart(3, '0')}`, 'mentions'),
    );

    const result = selectRelatedEntities(rows, MCP_RELATED_ENTITY_SELECTION, 7);

    expect(limit).toBe(100);
    expect(result.relatedEntities).toHaveLength(limit);
    expect(result.candidateEntityCount).toBe(limit + 25 + 7);
    expect(result.omittedEntityCount).toBe(25 + 7);
  });

  it('keeps every entity below the cap and orders ties deterministically', () => {
    const rows = [row('b', 'mentions'), row('a', 'mentions')];

    const forward = selectRelatedEntities(rows, { maxEntities: 100 }, 0);
    const reversed = selectRelatedEntities(
      [...rows].reverse(),
      { maxEntities: 100 },
      0,
    );

    expect(forward.omittedEntityCount).toBe(0);
    expect(forward.relatedEntities.map((e) => e.entityId)).toEqual(['a', 'b']);
    expect(reversed.relatedEntities.map((e) => e.entityId)).toEqual(['a', 'b']);
  });

  it('leaves rows untouched without a policy but still reports Graph omissions', () => {
    const rows = [row('b', 'mentions'), row('a', 'mentions')];

    const result = selectRelatedEntities(rows, undefined, 4);

    expect(result.relatedEntities).toBe(rows);
    expect(result.candidateEntityCount).toBe(6);
    expect(result.omittedEntityCount).toBe(4);
  });
});
