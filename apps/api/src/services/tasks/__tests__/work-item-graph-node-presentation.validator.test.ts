import {
  validateWorkItemGraphNodePresentationContent,
  WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_VERSION,
} from '../work-item-graph-node-presentation.validator';

describe('work item graph node presentation validator', () => {
  it('canonically serializes an authored color', () => {
    const result = validateWorkItemGraphNodePresentationContent({
      color: '#1a2B3c',
      schemaVersion: WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_VERSION,
    });

    expect(result).toEqual({
      success: true,
      canonicalContent: JSON.stringify({
        schemaVersion: WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_VERSION,
        color: '#1a2B3c',
      }),
    });
  });

  it('accepts JSON string content', () => {
    const result = validateWorkItemGraphNodePresentationContent(
      JSON.stringify({
        schemaVersion: WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_VERSION,
        color: '#ABCDEF',
      }),
    );

    expect(result.success).toBe(true);
  });

  it.each([
    ['unsupported schema version', { schemaVersion: 'v0', color: '#ABCDEF' }],
    [
      'invalid color',
      {
        schemaVersion: WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_VERSION,
        color: 'red',
      },
    ],
    [
      'extra keys',
      {
        schemaVersion: WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_VERSION,
        color: '#ABCDEF',
        extra: true,
      },
    ],
    ['malformed value', []],
  ])('rejects %s before persistence', (_label, content) => {
    const result = validateWorkItemGraphNodePresentationContent(content);

    expect(result.success).toBe(false);
  });
});
