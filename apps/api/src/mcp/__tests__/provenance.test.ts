import {
  influenceSchema,
  influencesArraySchema,
  buildProvenanceEnvelope,
  INFLUENCE_REASON_TYPES,
} from '../tools/provenance';
import type { RequestorContext } from '../tools/requestor-context';

const ENTITY_ID = '00000000-0000-4000-8000-000000000001';
const ENTITY_ID_2 = '00000000-0000-4000-8000-000000000002';

function makeRequestorContext(
  overrides: Partial<RequestorContext> = {},
): RequestorContext {
  return {
    userId: '00000000-0000-4000-8000-000000000099',
    organizationId: '00000000-0000-4000-8000-000000000001',
    toolName: 'edit_task',
    timestamp: new Date().toISOString(),
    source: 'agent',
    ...overrides,
  };
}

function makeInfluence(overrides: Record<string, unknown> = {}) {
  return {
    entityId: ENTITY_ID,
    entityType: 'ARTIFACT',
    reasoning: 'This entity provided context for the decision',
    reasonType: 'explicit_mention',
    ...overrides,
  };
}

describe('influenceSchema', () => {
  it('accepts a valid influence with all fields', () => {
    const input = makeInfluence({ confidence: 0.85 });
    const result = influenceSchema.parse(input);
    expect(result).toEqual(input);
  });

  it('accepts influence without optional confidence', () => {
    const input = makeInfluence();
    const result = influenceSchema.parse(input);
    expect(result.confidence).toBeUndefined();
  });

  it.each(['PLAN', 'project_defined_subtype'])(
    'accepts opaque TASK subtype snapshots: %s',
    (taskType) => {
      const result = influenceSchema.parse(
        makeInfluence({ entityType: 'TASK', taskType }),
      );

      expect(result.taskType).toBe(taskType);
    },
  );

  it('keeps taskType omitted when the influence does not provide one', () => {
    const result = influenceSchema.parse(makeInfluence({ entityType: 'TASK' }));

    expect(result).not.toHaveProperty('taskType');
  });

  it.each(INFLUENCE_REASON_TYPES)('accepts reasonType "%s"', (reasonType) => {
    const result = influenceSchema.safeParse(makeInfluence({ reasonType }));
    expect(result.success).toBe(true);
  });

  it('exposes origin in INFLUENCE_REASON_TYPES', () => {
    expect(INFLUENCE_REASON_TYPES).toContain('origin');
  });

  it('rejects invalid reasonType', () => {
    const result = influenceSchema.safeParse(
      makeInfluence({ reasonType: 'unknown_type' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects typed relationship fields instead of stripping them', () => {
    const result = influenceSchema.safeParse(
      makeInfluence({ edgeType: 'DEPENDS_ON' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects non-uuid entityId', () => {
    const result = influenceSchema.safeParse(
      makeInfluence({ entityId: 'not-a-uuid' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects empty reasoning', () => {
    const result = influenceSchema.safeParse(makeInfluence({ reasoning: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects reasoning exceeding 2000 chars', () => {
    const result = influenceSchema.safeParse(
      makeInfluence({ reasoning: 'A'.repeat(2001) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects confidence below 0', () => {
    const result = influenceSchema.safeParse(
      makeInfluence({ confidence: -0.1 }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects confidence above 1', () => {
    const result = influenceSchema.safeParse(
      makeInfluence({ confidence: 1.1 }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts confidence at boundaries (0 and 1)', () => {
    expect(
      influenceSchema.safeParse(makeInfluence({ confidence: 0 })).success,
    ).toBe(true);
    expect(
      influenceSchema.safeParse(makeInfluence({ confidence: 1 })).success,
    ).toBe(true);
  });
});

describe('influencesArraySchema', () => {
  it('defaults to empty array when given undefined', () => {
    const result = influencesArraySchema.parse(undefined);
    expect(result).toEqual([]);
  });

  it('accepts an empty array', () => {
    const result = influencesArraySchema.parse([]);
    expect(result).toEqual([]);
  });

  it('accepts multiple valid influences', () => {
    const input = [
      makeInfluence(),
      makeInfluence({
        entityId: ENTITY_ID_2,
        reasonType: 'derived',
        confidence: 0.5,
      }),
    ];
    const result = influencesArraySchema.parse(input);
    expect(result).toHaveLength(2);
  });

  it('rejects arrays exceeding 100 entries', () => {
    const input = Array.from({ length: 101 }, (_, i) =>
      makeInfluence({
        entityId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      }),
    );
    const result = influencesArraySchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects array containing invalid influence', () => {
    const input = [makeInfluence(), makeInfluence({ entityId: 'bad-id' })];
    const result = influencesArraySchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe('buildProvenanceEnvelope', () => {
  it('builds envelope with influences and version', () => {
    const ctx = makeRequestorContext();
    const influences = [makeInfluence()];
    const result = buildProvenanceEnvelope(ctx, influences, 'claude-3.5');

    expect(result.influences).toHaveLength(1);
    expect(result.influences[0]!.entityId).toBe(ENTITY_ID);
    expect(result.generatedWithVersion).toBe('claude-3.5');
    expect(result.requestorContext).toBe(ctx);
  });

  it('builds envelope with empty influences when undefined', () => {
    const ctx = makeRequestorContext();
    const result = buildProvenanceEnvelope(ctx, undefined);

    expect(result.influences).toEqual([]);
    expect(result.generatedWithVersion).toBeUndefined();
  });

  it('validates influences during envelope creation', () => {
    const ctx = makeRequestorContext();
    const badInfluences = [
      { entityId: 'bad', reasoning: '', reasonType: 'invalid' },
    ];

    expect(() => buildProvenanceEnvelope(ctx, badInfluences)).toThrow();
  });

  it('omits generatedWithVersion when not provided', () => {
    const ctx = makeRequestorContext();
    const result = buildProvenanceEnvelope(ctx, []);

    expect(result).not.toHaveProperty('generatedWithVersion');
  });

  it('produces JSON-serializable output', () => {
    const ctx = makeRequestorContext();
    const influences = [
      makeInfluence({ confidence: 0.9 }),
      makeInfluence({
        entityId: ENTITY_ID_2,
        reasonType: 'implied',
      }),
    ];
    const result = buildProvenanceEnvelope(ctx, influences, 'v1.0');
    const serialized = JSON.parse(JSON.stringify(result));
    expect(serialized).toEqual(result);
  });
});
