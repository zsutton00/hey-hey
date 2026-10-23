import {
  validateWorkItemStructuredMockupContent,
  WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V3,
  WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V4,
  WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V5,
} from '../work-item-structured-mockup.validator';

const fit = { mode: 'fit' as const };
const fill = { mode: 'fill' as const };
const content = { mode: 'content' as const };

const button = (id: string, label: string) => ({
  type: 'button' as const,
  props: { id, label, width: fit, height: content },
});

const fixtures = {
  stackedButtons: {
    schemaVersion: WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V3,
    revision: 1,
    sizeKey: 'panel',
    annotations: [],
    content: [
      {
        type: 'column' as const,
        props: {
          id: 'actions',
          width: fill,
          height: content,
          gap: 12,
          padding: 16,
          justify: 'start' as const,
          align: 'start' as const,
        },
        children: [button('save', 'Save'), button('cancel', 'Cancel')],
      },
    ],
  },
  horizontalButtonRow: {
    schemaVersion: WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V3,
    revision: 1,
    annotations: [],
    content: [
      {
        type: 'row' as const,
        props: {
          id: 'actions',
          width: fit,
          height: content,
          gap: 8,
          padding: 0,
          justify: 'center' as const,
          align: 'center' as const,
        },
        children: [button('previous', 'Previous'), button('next', 'Next')],
      },
    ],
  },
  spreadRow: {
    schemaVersion: WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V3,
    revision: 1,
    annotations: [],
    content: [
      {
        type: 'row' as const,
        props: {
          id: 'actions',
          width: fill,
          height: content,
          gap: 8,
          padding: 0,
          justify: 'spread' as const,
          align: 'stretch' as const,
        },
        children: [button('back', 'Back'), button('continue', 'Continue')],
      },
    ],
  },
};

describe('work item structured mockup validator', () => {
  it('preserves v4 occurrence identity and ordered recursive slot assignments', () => {
    const document = {
      schemaVersion: WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V4,
      revision: 2,
      annotations: [],
      content: [
        {
          type: 'mockup-occurrence',
          props: {
            id: 'occurrence-1',
            width: { mode: 'fit' },
            height: { mode: 'content' },
            sourceMockupId: '10000000-0000-4000-8000-000000000001',
            slotAssignments: [
              {
                slotName: 'content',
                children: [
                  {
                    type: 'text',
                    props: {
                      id: 'child-1',
                      width: { mode: 'fit' },
                      height: { mode: 'content' },
                      text: 'First',
                    },
                  },
                  {
                    type: 'icon',
                    props: {
                      id: 'child-2',
                      width: { mode: 'fit' },
                      height: { mode: 'content' },
                      iconKey: 'star',
                      accessibleLabel: 'Star',
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const result = validateWorkItemStructuredMockupContent(document);
    expect(result.success).toBe(true);
    if (result.success)
      expect(JSON.parse(result.canonicalContent)).toEqual(document);
  });

  it('rejects a source id reused as its local occurrence id', () => {
    expect(
      validateWorkItemStructuredMockupContent({
        schemaVersion: WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V4,
        revision: 1,
        annotations: [],
        content: [
          {
            type: 'mockup-occurrence',
            props: {
              id: '10000000-0000-4000-8000-000000000001',
              width: { mode: 'fit' },
              height: { mode: 'content' },
              sourceMockupId: '10000000-0000-4000-8000-000000000001',
              slotAssignments: [],
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts v5 primitives, semantic metadata, and bounded appearance', () => {
    const document = {
      schemaVersion: WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V5,
      revision: 4,
      annotations: [],
      content: [
        {
          type: 'row' as const,
          props: {
            id: 'toolbar',
            width: fill,
            height: content,
            gap: 8,
            padding: 4,
            justify: 'spread' as const,
            align: 'center' as const,
            role: 'navigation' as const,
            description: 'Primary actions',
            color: 'primary' as const,
            opacity: 0.9,
            overflow: 'hidden' as const,
          },
          children: [
            {
              type: 'icon' as const,
              props: {
                id: 'settings',
                width: fit,
                height: content,
                iconKey: 'settings' as const,
                accessibleLabel: 'Settings',
              },
            },
            {
              type: 'caret' as const,
              props: {
                id: 'next',
                width: fit,
                height: content,
                direction: 'right' as const,
              },
            },
            {
              type: 'shape' as const,
              props: {
                id: 'status',
                width: { mode: 'fixed' as const, value: 20 },
                height: { mode: 'fixed' as const, value: 20 },
                kind: 'circle' as const,
                color: 'success' as const,
              },
            },
            {
              type: 'divider' as const,
              props: {
                id: 'divider',
                width: fit,
                height: content,
                orientation: 'vertical' as const,
              },
            },
          ],
        },
      ],
    };

    const result = validateWorkItemStructuredMockupContent(document);
    expect(result.success).toBe(true);
    if (result.success)
      expect(JSON.parse(result.canonicalContent)).toEqual(document);
  });

  it.each([
    ['unknown icon key', { iconKey: 'custom-svg' }],
    ['opacity outside the inclusive range', { opacity: 1.1 }],
    ['unknown property', { renderer: 'javascript' }],
  ])('rejects v5 %s', (_reason, change) => {
    const component = {
      type: 'icon' as const,
      props: {
        id: 'icon',
        width: fit,
        height: content,
        iconKey: 'star' as string,
        accessibleLabel: 'Icon',
        ...change,
      },
    };
    expect(
      validateWorkItemStructuredMockupContent({
        schemaVersion: WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V5,
        revision: 1,
        annotations: [],
        content: [component],
      }).success,
    ).toBe(false);
  });

  it.each([
    ['start', 'stretch'],
    ['center', 'start'],
    ['end', 'center'],
    ['spread', 'end'],
  ])('accepts independent v3 justify=%s and align=%s', (justify, align) => {
    const document = {
      schemaVersion: WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V3,
      revision: 1,
      annotations: [],
      content: [
        {
          type: 'row',
          props: {
            id: 'actions',
            width: fill,
            height: content,
            gap: 8,
            padding: 0,
            justify,
            align,
          },
          children: [],
        },
      ],
    };

    const result = validateWorkItemStructuredMockupContent(document);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(JSON.parse(result.canonicalContent)).toEqual(document);
    }
  });

  it.each(['work-item-structured-mockup.v1', 'work-item-structured-mockup.v2'])(
    'rejects removed %s documents with a version-aware diagnostic',
    (version) => {
      const result = validateWorkItemStructuredMockupContent({
        schemaVersion: version,
        content: [],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.path).toEqual(['schemaVersion']);
        expect(result.message).toContain('work-item-structured-mockup.v3');
        expect(result.message).not.toContain(
          'send a work-item-structured-mockup.v1',
        );
      }
    },
  );

  it('reports the nested v3 field that violates the independent axis contract', () => {
    const result = validateWorkItemStructuredMockupContent({
      ...fixtures.spreadRow,
      content: [
        {
          ...fixtures.spreadRow.content[0],
          props: {
            ...fixtures.spreadRow.content[0]!.props,
            align: 'spread',
          },
        },
      ],
    });

    expect(result).toMatchObject({
      success: false,
      path: ['content', 0, 'props', 'align'],
    });
  });

  const annotationId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const annotatedDocument = {
    schemaVersion: WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V3,
    revision: 3,
    sizeKey: 'panel',
    content: [button('save', 'Save')],
    annotations: [
      {
        id: annotationId,
        note: 'Keep the primary action visible.',
        author: { type: 'human' as const, userId },
        category: 'suggestion' as const,
        lifecycle: 'open' as const,
        authoredProposalId: '20000000-0000-4000-8000-000000000001',
        authoredSizeKey: 'panel',
        target: { type: 'component' as const, componentId: 'save' },
      },
    ],
  };

  it('round-trips v3 annotations unchanged', () => {
    const result = validateWorkItemStructuredMockupContent(
      annotatedDocument,
      new Set(['panel']),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(JSON.parse(result.canonicalContent)).toEqual(annotatedDocument);
    }
  });

  it.each([
    [
      'out-of-bounds normalized target',
      {
        ...annotatedDocument,
        annotations: [
          {
            ...annotatedDocument.annotations[0],
            target: { type: 'position', x: 1.1, y: 0.5 },
          },
        ],
      },
    ],
    [
      'conversation-backed annotation',
      {
        ...annotatedDocument,
        annotations: [
          {
            ...annotatedDocument.annotations[0],
            conversationId: '33333333-3333-4333-8333-333333333333',
          },
        ],
      },
    ],
    [
      'threaded annotation',
      {
        ...annotatedDocument,
        annotations: [{ ...annotatedDocument.annotations[0], replies: [] }],
      },
    ],
    [
      'blank note',
      {
        ...annotatedDocument,
        annotations: [{ ...annotatedDocument.annotations[0], note: '' }],
      },
    ],
  ])('rejects a v3 document with %s', (_label, value) => {
    expect(
      validateWorkItemStructuredMockupContent(value, new Set(['panel']))
        .success,
    ).toBe(false);
  });

  it('preserves a component annotation after its target is removed', () => {
    const value = {
      ...annotatedDocument,
      revision: 4,
      content: [],
    };

    const result = validateWorkItemStructuredMockupContent(
      value,
      new Set(['panel']),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(JSON.parse(result.canonicalContent)).toEqual(value);
    }
  });

  it('preserves text hierarchy, nested surfaces and multiline writing areas', () => {
    const document = {
      schemaVersion: WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V3,
      revision: 1,
      annotations: [],
      content: [
        {
          type: 'column',
          props: {
            id: 'panel',
            width: fill,
            height: content,
            gap: 16,
            padding: 24,
            justify: 'start',
            align: 'start',
            surface: 'panel',
          },
          children: [
            {
              type: 'text',
              props: {
                id: 'title',
                width: fit,
                height: content,
                text: 'Write your notes',
                variant: 'heading',
              },
            },
            {
              type: 'input',
              props: {
                id: 'notes',
                width: fill,
                height: { mode: 'fixed', value: 460 },
                label: 'Notes',
                placeholder: '',
                value: 'First line\nSecond line',
                multiline: true,
              },
            },
          ],
        },
      ],
    };
    const result = validateWorkItemStructuredMockupContent(document);
    expect(result.success).toBe(true);
    if (result.success)
      expect(JSON.parse(result.canonicalContent)).toEqual(document);
    const panel = document.content[0];
    if (!panel) throw new Error('Expected panel fixture');
    expect(
      validateWorkItemStructuredMockupContent({
        ...document,
        content: [
          {
            ...panel,
            props: { ...panel.props, surface: 'arbitrary-css' },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each(Object.entries(fixtures))(
    'canonically preserves the %s fixture',
    (_name, fixture) => {
      const result = validateWorkItemStructuredMockupContent(
        fixture,
        new Set(['panel']),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(JSON.parse(result.canonicalContent)).toEqual(fixture);
      }
    },
  );

  it('accepts the persisted JSON representation without losing structure', () => {
    const result = validateWorkItemStructuredMockupContent(
      JSON.stringify(fixtures.stackedButtons),
      new Set(['panel']),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(JSON.parse(result.canonicalContent)).toEqual(
        fixtures.stackedButtons,
      );
    }
  });

  it.each([
    ['unsupported version', { ...fixtures.spreadRow, schemaVersion: 'v2' }],
    [
      'unsupported component',
      {
        ...fixtures.spreadRow,
        content: [{ type: 'video', props: { id: 'video' } }],
      },
    ],
    [
      'duplicate document-local ids',
      {
        ...fixtures.horizontalButtonRow,
        content: [button('duplicate', 'One'), button('duplicate', 'Two')],
      },
    ],
    [
      'fixed width without a value',
      {
        ...fixtures.horizontalButtonRow,
        content: [
          {
            ...button('invalid-width', 'Invalid'),
            props: {
              ...button('invalid-width', 'Invalid').props,
              width: { mode: 'fixed' },
            },
          },
        ],
      },
    ],
    [
      'renderer payload',
      {
        ...fixtures.horizontalButtonRow,
        content: [
          {
            ...button('unsafe', 'Unsafe'),
            props: {
              ...button('unsafe', 'Unsafe').props,
              render: '<script />',
            },
          },
        ],
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(validateWorkItemStructuredMockupContent(value).success).toBe(false);
  });

  it('rejects a presentation selection outside the type definition', () => {
    const result = validateWorkItemStructuredMockupContent(
      { ...fixtures.stackedButtons, sizeKey: 'unknown' },
      new Set(['panel']),
    );

    expect(result).toEqual({
      success: false,
      message:
        "Structured mockup content references unknown sizeKey 'unknown'.",
      path: ['sizeKey'],
    });
  });

  it('rejects excessive nesting without throwing', () => {
    let nested: unknown = button('leaf', 'Leaf');
    for (let index = 0; index < 2_000; index += 1) {
      nested = {
        type: 'row',
        props: {
          id: `row-${index}`,
          width: fit,
          height: content,
          gap: 0,
          padding: 0,
          justify: 'start',
          align: 'start',
        },
        children: [nested],
      };
    }

    expect(() =>
      validateWorkItemStructuredMockupContent({
        schemaVersion: WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V3,
        revision: 1,
        annotations: [],
        content: [nested],
      }),
    ).not.toThrow();
    expect(
      validateWorkItemStructuredMockupContent({
        schemaVersion: WORK_ITEM_STRUCTURED_MOCKUP_SCHEMA_VERSION_V3,
        revision: 1,
        annotations: [],
        content: [nested],
      }),
    ).toEqual({
      success: false,
      message:
        'Structured mockup content is too deeply nested to validate safely.',
      path: ['content'],
    });
  });
});
