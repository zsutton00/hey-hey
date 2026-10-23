import {
  validateWorkItemGraphLayoutContent,
  validateWorkItemGraphLayoutPreferenceContent,
  WORK_ITEM_GRAPH_LAYOUT_PREFERENCE_SCHEMA_VERSION,
  WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
} from '../work-item-graph-layout.validator';

const persistedNodeId = '11111111-1111-4111-8111-111111111111';

function validLayout() {
  return {
    schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
    nodes: [
      {
        position: { y: 20, x: 10 },
        node: { workItemId: persistedNodeId, kind: 'persistedWorkItem' },
      },
      {
        node: { kind: 'temporaryWorkItem', temporaryRef: 'node:1' },
        position: { x: -4.5, y: 0 },
      },
    ],
  };
}

describe('work item graph layout validator', () => {
  it('canonically serializes valid persisted and temporary node positions', () => {
    const result = validateWorkItemGraphLayoutContent(validLayout());

    expect(result.success).toBe(true);
    expect(result.success ? result.canonicalContent : '').toBe(
      JSON.stringify({
        schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
        nodes: [
          {
            node: { kind: 'persistedWorkItem', workItemId: persistedNodeId },
            position: { x: 10, y: 20 },
          },
          {
            node: { kind: 'temporaryWorkItem', temporaryRef: 'node:1' },
            position: { x: -4.5, y: 0 },
          },
        ],
      }),
    );
  });

  it('accepts JSON string content and returns the same canonical serialization', () => {
    const result = validateWorkItemGraphLayoutContent(
      JSON.stringify(validLayout()),
    );

    expect(result.success).toBe(true);
    expect(result.success ? result.value.nodes.length : 0).toBe(2);
  });

  it.each([
    ['unsupported schema version', { schemaVersion: 'v0', nodes: [] }],
    ['malformed value', []],
    [
      'incomplete coordinates',
      {
        schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
        nodes: [
          {
            node: { kind: 'temporaryWorkItem', temporaryRef: 'n1' },
            position: { x: 1 },
          },
        ],
      },
    ],
    [
      'non-finite coordinates',
      {
        schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
        nodes: [
          {
            node: { kind: 'temporaryWorkItem', temporaryRef: 'n1' },
            position: { x: Number.POSITIVE_INFINITY, y: 1 },
          },
        ],
      },
    ],
    [
      'extra keys',
      {
        schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
        nodes: [],
        extra: true,
      },
    ],
  ])('rejects %s before persistence', (_label, content) => {
    const result = validateWorkItemGraphLayoutContent(content);

    expect(result.success).toBe(false);
  });
});

describe('work item graph layout preference validator', () => {
  it.each([
    {
      schemaVersion: WORK_ITEM_GRAPH_LAYOUT_PREFERENCE_SCHEMA_VERSION,
      rows: 2,
      columns: 4,
    },
    '{"columns":4,"rows":2,"schemaVersion":"work-item-graph-layout-preference.v1"}',
  ])(
    'accepts and canonically serializes a positive-integer shape',
    (content) => {
      const result = validateWorkItemGraphLayoutPreferenceContent(content);
      expect(result.success).toBe(true);
      expect(result.success ? result.canonicalContent : '').toBe(
        '{"schemaVersion":"work-item-graph-layout-preference.v1","rows":2,"columns":4}',
      );
    },
  );

  it.each([
    { rows: 0, columns: 1 },
    { rows: 1.5, columns: 1 },
    { rows: 1, columns: -1 },
    { rows: 1, columns: 1, extra: true },
  ])('rejects invalid preferred dimensions %#', (dimensions) => {
    expect(
      validateWorkItemGraphLayoutPreferenceContent({
        schemaVersion: WORK_ITEM_GRAPH_LAYOUT_PREFERENCE_SCHEMA_VERSION,
        ...dimensions,
      }).success,
    ).toBe(false);
  });
});
