import { AgentEdgeType } from '../../generated/graphs/model/agentEdgeType';
import { GetDiagramToolsProvider } from './get-diagram-tools.provider';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const DIAGRAM_ID = '44444444-4444-4444-8444-444444444444';
const STEP_ONE_ID = '55555555-5555-4555-8555-555555555555';
const STEP_TWO_ID = '66666666-6666-4666-8666-666666666666';
const CONTRACT_ID = '77777777-7777-4777-8777-777777777777';
const IMPLEMENTATION_ID = '88888888-8888-4888-8888-888888888888';
const MOCKUP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const graphCapability = {
  nodeChildType: 'DIAGRAM_ELEMENT',
  layout: {
    sectionKey: 'graphLayout',
    schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
  },
  groups: {
    sectionKey: 'diagramGroups',
    schemaRef: '#/components/schemas/DiagramGroupsValue',
  },
  readableRelationships: [
    { edgeType: 'STANDARD', category: 'flow' },
    { edgeType: 'CONDITIONAL', category: 'flow' },
    { edgeType: 'LOOP', category: 'flow' },
    { edgeType: 'FULFILLED_BY', category: 'meta' },
    { edgeType: 'GUARANTEES', category: 'meta' },
    { edgeType: 'DEPENDS_ON', category: 'meta' },
    { edgeType: 'RELATED_TO', category: 'meta' },
  ],
};

const POSITIONED_LAYOUT = JSON.stringify({
  schemaVersion: 'work-item-graph-layout.v1',
  nodes: [
    {
      node: { kind: 'persistedWorkItem', workItemId: STEP_ONE_ID },
      position: { x: 120, y: 80 },
    },
  ],
});

const DIAGRAM_GROUPS = JSON.stringify({
  schemaVersion: 'diagram-groups.v1',
  groups: [
    {
      id: 'storefront',
      label: 'Storefront',
      meaning: 'STRUCTURAL_BOUNDARY',
      members: [{ kind: 'persistedWorkItem', workItemId: STEP_ONE_ID }],
    },
    {
      id: 'payments',
      label: 'Payments',
      meaning: 'VISUAL_ASSOCIATION',
      parentGroupId: 'storefront',
      members: [{ kind: 'persistedWorkItem', workItemId: STEP_TWO_ID }],
    },
  ],
});

const DIAGRAM_DESCRIPTION = [
  'Checkout starts at the cart and ends when payment is accepted.',
  '',
  `  Implemented by @[task:${IMPLEMENTATION_ID}|Implement checkout].`,
].join('\n');

const SHOPPER_DESCRIPTION =
  'Shopper state at entry.\nNo payment data is read here.';

const CHECKOUT_TEXT = [
  `DIAGRAM ${DIAGRAM_ID} "Checkout" kind=PROCESS level=OVERVIEW`,
  '    Checkout starts at the cart and ends when payment is accepted.',
  '    ',
  `      Implemented by @[task:${IMPLEMENTATION_ID}|Implement checkout].`,
  'elements:',
  `  ${STEP_ONE_ID} START "Shopper opens cart" ref=- group=storefront`,
  '    Shopper state at entry.',
  '    No payment data is read here.',
  `  ${STEP_TWO_ID} GENERIC "Validate payment" ref=TASK:${IMPLEMENTATION_ID} group=payments`,
  'flow:',
  `  edge-standard ${STEP_ONE_ID} -> ${STEP_TWO_ID} STANDARD direction=forward action="tap Continue"`,
  `  edge-conditional ${STEP_TWO_ID} -> ${STEP_ONE_ID} CONDITIONAL direction=backward predicate="payment \\"declined\\""`,
  `  edge-loop ${STEP_TWO_ID} -> ${STEP_TWO_ID} LOOP`,
  'fulfillment:',
  `  edge-fulfillment ${STEP_ONE_ID} FULFILLED_BY STANDARD:${IMPLEMENTATION_ID} "Implement checkout"`,
  'contracts:',
  `  edge-guarantee ${STEP_TWO_ID} GUARANTEES CONTRACT:${CONTRACT_ID} "Payment contract"`,
  'links:',
  `  edge-depends ${STEP_TWO_ID} DEPENDS_ON CONTRACT:${CONTRACT_ID} "Payment contract"`,
  `  edge-related ${STEP_ONE_ID} RELATED_TO mockup:${MOCKUP_ID} "Checkout mockup"`,
  `  edge-root-related ${DIAGRAM_ID} RELATED_TO STANDARD:${IMPLEMENTATION_ID} "Implement checkout"`,
  'groups:',
  `  storefront "Storefront" STRUCTURAL_BOUNDARY parent=- members=${STEP_ONE_ID}`,
  `  payments "Payments" VISUAL_ASSOCIATION parent=storefront members=${STEP_TWO_ID}`,
  'layout: omitted; replace the whole layout through edit_work_item',
].join('\n');

const EMPTY_TEXT = [
  `DIAGRAM ${DIAGRAM_ID} "Empty" kind=GENERAL level=OVERVIEW`,
  'elements:',
  '  none returned by this read',
  'flow:',
  '  none returned by this read',
  'fulfillment:',
  '  none returned by this read',
  'contracts:',
  '  none returned by this read',
  'links:',
  '  none returned by this read',
  'groups:',
  '  none returned by this read',
  'layout: omitted; replace the whole layout through edit_work_item',
].join('\n');

function workItem(
  id: string,
  type: string,
  name: string,
  projectId = PROJECT_ID,
  parentTaskId?: string,
  sections: Array<{ key: string; materializedMarkdown: string }> = [],
): Record<string, unknown> {
  return {
    id,
    name,
    type,
    organizationId: ORGANIZATION_ID,
    projectId,
    parentTaskId,
    status: 'BACKLOG',
    source: 'USER',
    sections,
  };
}

function diagramSections(
  layout?: string,
  kind = 'PROCESS',
): Array<{
  key: string;
  materializedMarkdown: string;
}> {
  return [
    {
      key: 'diagramMetadata',
      materializedMarkdown: JSON.stringify({
        kind,
        level: 'OVERVIEW',
      }),
    },
    { key: 'diagramGroups', materializedMarkdown: DIAGRAM_GROUPS },
    { key: 'description', materializedMarkdown: DIAGRAM_DESCRIPTION },
    ...(layout === undefined
      ? []
      : [{ key: 'graphLayout', materializedMarkdown: layout }]),
  ];
}

function elementSections(role: string, canonicalReference?: object) {
  return [
    {
      key: 'diagramElementMetadata',
      materializedMarkdown: JSON.stringify({
        role,
        ...(canonicalReference ? { canonicalReference } : {}),
      }),
    },
  ];
}

function step(
  id: string,
  name: string,
  sections: Array<{ key: string; materializedMarkdown: string }>,
): Record<string, unknown> {
  return workItem(
    id,
    'DIAGRAM_ELEMENT',
    name,
    PROJECT_ID,
    DIAGRAM_ID,
    sections,
  );
}

function edge(
  id: string,
  type: string,
  sourceNodeId: string,
  targetNodeId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    sourceNodeId,
    targetNodeId,
    type,
    reasoning: `${type} relationship`,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...extra,
  };
}

function checkoutEdges(): Record<string, unknown>[] {
  return [
    edge('edge-standard', AgentEdgeType.Standard, STEP_ONE_ID, STEP_TWO_ID, {
      category: 'flow',
      direction: 'forward',
      actionLabel: 'tap Continue',
    }),
    edge(
      'edge-conditional',
      AgentEdgeType.Conditional,
      STEP_TWO_ID,
      STEP_ONE_ID,
      {
        category: 'flow',
        direction: 'backward',
        predicate: 'payment "declined"',
      },
    ),
    edge('edge-loop', AgentEdgeType.Loop, STEP_TWO_ID, STEP_TWO_ID, {
      category: 'flow',
    }),
    edge(
      'edge-fulfillment',
      AgentEdgeType.FulfilledBy,
      STEP_ONE_ID,
      IMPLEMENTATION_ID,
      {
        category: 'meta',
        targetNodeType: 'STANDARD',
        targetNodeName: 'Implement checkout',
      },
    ),
    edge('edge-guarantee', AgentEdgeType.Guarantees, STEP_TWO_ID, CONTRACT_ID, {
      category: 'meta',
      targetNodeType: 'CONTRACT',
      targetNodeName: 'Payment contract',
    }),
    edge('edge-depends', AgentEdgeType.DependsOn, STEP_TWO_ID, CONTRACT_ID, {
      category: 'meta',
      targetNodeType: 'CONTRACT',
      targetNodeName: 'Payment contract',
    }),
    edge('edge-related', AgentEdgeType.RelatedTo, STEP_ONE_ID, MOCKUP_ID, {
      category: 'meta',
      targetNodeType: 'mockup',
      targetNodeName: 'Checkout mockup',
    }),
    edge(
      'edge-root-related',
      AgentEdgeType.RelatedTo,
      DIAGRAM_ID,
      IMPLEMENTATION_ID,
      {
        category: 'meta',
        targetNodeType: 'STANDARD',
        targetNodeName: 'Implement checkout',
      },
    ),
    edge('edge-incoming', AgentEdgeType.RelatedTo, MOCKUP_ID, STEP_ONE_ID, {
      category: 'meta',
    }),
  ];
}

function request(projectId = PROJECT_ID): any {
  return {
    user: { currentOrgId: ORGANIZATION_ID },
    headers: {
      authorization: 'Bearer test-token',
      'x-project-id': projectId,
    },
  };
}

function textOf(result: unknown): string {
  const content = (result as CallToolResult).content.find(
    (item) => item.type === 'text',
  );
  if (content?.type !== 'text') throw new Error('Expected text content');
  return content.text;
}

// Reads back the description block under a line, the way a rebuild does.
function descriptionAfter(text: string, line: string): string {
  const lines = text.split('\n');
  const block: string[] = [];
  for (const next of lines.slice(lines.indexOf(line) + 1)) {
    if (!next.startsWith('    ')) break;
    block.push(next.slice('    '.length));
  }
  return block.join('\n');
}

describe('GetDiagramToolsProvider', () => {
  let taskService: {
    findOneByOrganization: jest.Mock;
    findAll: jest.Mock;
  };
  let workItemTypeRegistry: { getGraphCapability: jest.Mock };
  let agentEdgeClient: { findIncident: jest.Mock };
  let provider: GetDiagramToolsProvider;

  beforeEach(() => {
    taskService = {
      findOneByOrganization: jest
        .fn()
        .mockResolvedValue(
          workItem(DIAGRAM_ID, 'DIAGRAM', 'Checkout', PROJECT_ID, undefined, [
            ...diagramSections(POSITIONED_LAYOUT),
          ]),
        ),
      findAll: jest.fn().mockResolvedValue([
        step(STEP_ONE_ID, 'Shopper opens cart', [
          ...elementSections('START'),
          { key: 'description', materializedMarkdown: SHOPPER_DESCRIPTION },
        ]),
        step(STEP_TWO_ID, 'Validate payment', [
          ...elementSections('GENERIC', {
            entityType: 'TASK',
            entityId: IMPLEMENTATION_ID,
          }),
        ]),
      ]),
    };
    workItemTypeRegistry = {
      getGraphCapability: jest.fn().mockReturnValue(graphCapability),
    };
    agentEdgeClient = {
      findIncident: jest.fn().mockResolvedValue(checkoutEdges()),
    };
    provider = new GetDiagramToolsProvider(
      taskService as any,
      workItemTypeRegistry as any,
      agentEdgeClient as any,
    );
  });

  it('renders kind, level, elements, every link category and groups as text', async () => {
    const result = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      request(),
    );

    expect(result).not.toHaveProperty('isError');
    expect(textOf(result)).toBe(CHECKOUT_TEXT);
  });

  it('identifies UX_FLOW and shows its triggering actions in the compact read', async () => {
    taskService.findOneByOrganization.mockResolvedValueOnce(
      workItem(DIAGRAM_ID, 'DIAGRAM', 'Checkout', PROJECT_ID, undefined, [
        ...diagramSections(undefined, 'UX_FLOW'),
      ]),
    );

    const result = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      request(),
    );
    const text = textOf(result);

    expect(text).toContain(
      `DIAGRAM ${DIAGRAM_ID} "Checkout" kind=UX_FLOW level=OVERVIEW`,
    );
    expect(text).toContain(
      `  edge-standard ${STEP_ONE_ID} -> ${STEP_TWO_ID} STANDARD direction=forward action="tap Continue"`,
    );
  });

  it('reads the same view whether the layout is positioned, cleared or missing', async () => {
    for (const layout of [POSITIONED_LAYOUT, '  \n', undefined]) {
      taskService.findOneByOrganization.mockResolvedValueOnce(
        workItem(DIAGRAM_ID, 'DIAGRAM', 'Checkout', PROJECT_ID, undefined, [
          ...diagramSections(layout),
        ]),
      );
      const result = await provider.getDiagram(
        { workflowId: DIAGRAM_ID },
        {} as any,
        request(),
      );
      expect(textOf(result)).toBe(CHECKOUT_TEXT);
    }
  });

  it('states that every category is a read result when nothing is returned', async () => {
    taskService.findOneByOrganization.mockResolvedValueOnce(
      workItem(DIAGRAM_ID, 'DIAGRAM', 'Empty', PROJECT_ID, undefined, [
        {
          key: 'diagramMetadata',
          materializedMarkdown: JSON.stringify({
            kind: 'GENERAL',
            level: 'OVERVIEW',
          }),
        },
      ]),
    );
    taskService.findAll.mockResolvedValueOnce([]);
    agentEdgeClient.findIncident.mockResolvedValueOnce([]);

    const result = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      request(),
    );

    expect(textOf(result)).toBe(EMPTY_TEXT);
  });

  it('reads a Diagram whose groups section is blank like one with no groups section', async () => {
    taskService.findOneByOrganization.mockResolvedValueOnce(
      workItem(DIAGRAM_ID, 'DIAGRAM', 'Empty', PROJECT_ID, undefined, [
        {
          key: 'diagramMetadata',
          materializedMarkdown: JSON.stringify({
            kind: 'GENERAL',
            level: 'OVERVIEW',
          }),
        },
        { key: 'diagramGroups', materializedMarkdown: '' },
        { key: 'graphLayout', materializedMarkdown: '' },
      ]),
    );
    taskService.findAll.mockResolvedValueOnce([]);
    agentEdgeClient.findIncident.mockResolvedValueOnce([]);

    const result = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      request(),
    );

    expect(result).not.toHaveProperty('isError');
    expect(textOf(result)).toBe(EMPTY_TEXT);
  });

  it('rebuilds the Diagram and element descriptions exactly from the text', async () => {
    const text = textOf(
      await provider.getDiagram(
        { workflowId: DIAGRAM_ID },
        {} as any,
        request(),
      ),
    );

    expect(
      descriptionAfter(
        text,
        `DIAGRAM ${DIAGRAM_ID} "Checkout" kind=PROCESS level=OVERVIEW`,
      ),
    ).toBe(DIAGRAM_DESCRIPTION);
    expect(
      descriptionAfter(
        text,
        `  ${STEP_ONE_ID} START "Shopper opens cart" ref=- group=storefront`,
      ),
    ).toBe(SHOPPER_DESCRIPTION);
  });

  it('prints nothing extra for a blank Diagram or element description', async () => {
    taskService.findOneByOrganization.mockResolvedValueOnce(
      workItem(DIAGRAM_ID, 'DIAGRAM', 'Blank', PROJECT_ID, undefined, [
        { key: 'description', materializedMarkdown: '  \n' },
      ]),
    );
    taskService.findAll.mockResolvedValueOnce([
      step(STEP_ONE_ID, 'Blank step', [
        { key: 'description', materializedMarkdown: '' },
      ]),
    ]);
    agentEdgeClient.findIncident.mockResolvedValueOnce([]);

    const result = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      request(),
    );

    expect(textOf(result)).toContain(
      `DIAGRAM ${DIAGRAM_ID} "Blank" kind=- level=-\nelements:\n  ${STEP_ONE_ID} - "Blank step" ref=- group=-\nflow:`,
    );
  });

  it('prints absent kind, level and element role as dashes instead of failing', async () => {
    taskService.findOneByOrganization.mockResolvedValueOnce(
      workItem(DIAGRAM_ID, 'workflow', 'Legacy', PROJECT_ID, undefined, []),
    );
    taskService.findAll.mockResolvedValueOnce([
      step(STEP_ONE_ID, 'Legacy step', []),
    ]);
    agentEdgeClient.findIncident.mockResolvedValueOnce([]);

    const result = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      request(),
    );

    expect(textOf(result)).toContain(
      `DIAGRAM ${DIAGRAM_ID} "Legacy" kind=- level=-`,
    );
    expect(textOf(result)).toContain(
      `  ${STEP_ONE_ID} - "Legacy step" ref=- group=-`,
    );
  });

  it('says when the element read hit its limit', async () => {
    taskService.findAll.mockResolvedValueOnce(
      Array.from({ length: 500 }, (_, index) =>
        step(
          `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          `Step ${index}`,
          elementSections('GENERIC'),
        ),
      ),
    );

    const result = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      request(),
    );

    expect(textOf(result)).toContain(
      '  more elements may exist beyond this read; the view is incomplete\nflow:',
    );
  });

  it('keeps Contract participation separate from DEPENDS_ON and flow', async () => {
    const result = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      request(),
    );
    const text = textOf(result);

    expect(text).toContain(
      `  edge-guarantee ${STEP_TWO_ID} GUARANTEES CONTRACT:${CONTRACT_ID} "Payment contract"`,
    );
    expect(text).toContain(
      `  edge-depends ${STEP_TWO_ID} DEPENDS_ON CONTRACT:${CONTRACT_ID} "Payment contract"`,
    );
    expect(text).not.toContain('edge-incoming');
  });

  it('fails visibly when a populated layout is malformed', async () => {
    taskService.findOneByOrganization.mockResolvedValueOnce(
      workItem(DIAGRAM_ID, 'DIAGRAM', 'Checkout', PROJECT_ID, undefined, [
        ...diagramSections(' {broken'),
      ]),
    );

    const result = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      request(),
    );

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: expect.stringContaining('Diagram layout is invalid:'),
        },
      ],
    });
  });

  it('fails visibly when an element has malformed metadata', async () => {
    taskService.findAll.mockResolvedValueOnce([
      step(STEP_ONE_ID, 'Broken step', [
        { key: 'diagramElementMetadata', materializedMarkdown: '{' },
      ]),
    ]);

    const result = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      request(),
    );

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: expect.stringContaining(
            `Diagram read failed: Diagram element ${STEP_ONE_ID} metadata`,
          ),
        },
      ],
    });
  });

  it('reads the children and incident edges with the declared graph capability', async () => {
    await provider.getDiagram({ workflowId: DIAGRAM_ID }, {} as any, request());

    expect(taskService.findOneByOrganization).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      DIAGRAM_ID,
      false,
      false,
      false,
      false,
      'test-token',
    );
    expect(taskService.findAll).toHaveBeenCalledTimes(1);
    expect(taskService.findAll).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      null,
      expect.objectContaining({
        projectId: PROJECT_ID,
        parentTaskId: DIAGRAM_ID,
        taskType: 'DIAGRAM_ELEMENT',
        includeSectionKeys: expect.any(Array),
        limit: 500,
      }),
    );
    expect(agentEdgeClient.findIncident).toHaveBeenCalledTimes(1);
    expect(agentEdgeClient.findIncident).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      PROJECT_ID,
      {
        nodeIds: new Set([DIAGRAM_ID, STEP_ONE_ID, STEP_TWO_ID]),
        types: new Set([
          AgentEdgeType.Standard,
          AgentEdgeType.Conditional,
          AgentEdgeType.Loop,
          AgentEdgeType.FulfilledBy,
          AgentEdgeType.Guarantees,
          AgentEdgeType.DependsOn,
          AgentEdgeType.RelatedTo,
        ]),
      },
      'test-token',
    );
  });

  it('fails visibly for authentication and project scope errors', async () => {
    const noAuth = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      { headers: {} } as any,
    );
    expect(noAuth).toMatchObject({ isError: true });
    expect(taskService.findOneByOrganization).not.toHaveBeenCalled();

    const outsideProject = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      request(OTHER_PROJECT_ID),
    );
    expect(outsideProject).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Diagram is outside the requested project scope.',
        },
      ],
    });
    expect(agentEdgeClient.findIncident).not.toHaveBeenCalled();
  });

  it('rejects missing and non-diagram targets instead of returning empty views', async () => {
    taskService.findOneByOrganization.mockResolvedValueOnce(null);
    const missing = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      request(),
    );
    expect(missing).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Diagram not found or not accessible.' }],
    });

    taskService.findOneByOrganization.mockResolvedValueOnce(
      workItem(DIAGRAM_ID, 'STANDARD', 'Not a diagram'),
    );
    const nonDiagram = await provider.getDiagram(
      { workflowId: DIAGRAM_ID },
      {} as any,
      request(),
    );
    expect(nonDiagram).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'The requested work item is not a graph-capable Diagram.',
        },
      ],
    });
    expect(taskService.findAll).not.toHaveBeenCalled();
  });
});
