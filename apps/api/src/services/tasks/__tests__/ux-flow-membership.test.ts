import {
  uxFlowMembershipsFromElements,
  type UxFlowElementRow,
} from '../ux-flow-membership';

const mockupId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';

function element(options: {
  id: string;
  diagramId: string;
  diagramName: string;
  kind?: string;
  referencesTask?: string;
  referenceType?: 'TASK' | 'SERVICE';
}): UxFlowElementRow {
  const reference = options.referencesTask
    ? {
        canonicalReference: {
          entityType: options.referenceType ?? 'TASK',
          entityId: options.referencesTask,
        },
      }
    : {};
  return {
    id: options.id,
    sections: [
      {
        materializedMarkdown: JSON.stringify({ role: 'GENERIC', ...reference }),
      },
    ],
    parentTask: {
      id: options.diagramId,
      name: options.diagramName,
      sections: [
        {
          materializedMarkdown: JSON.stringify({
            kind: options.kind ?? 'UX_FLOW',
            level: 'OVERVIEW',
          }),
        },
      ],
    },
  };
}

describe('uxFlowMembershipsFromElements', () => {
  it('lists the single UX flow that references the Mockup', () => {
    const flows = uxFlowMembershipsFromElements(
      [
        element({
          id: 'e1',
          diagramId: 'd1',
          diagramName: 'Checkout',
          referencesTask: mockupId,
        }),
      ],
      mockupId,
    );

    expect(flows).toEqual([
      { diagramId: 'd1', diagramName: 'Checkout', elementId: 'e1' },
    ]);
  });

  it('lists several flows by name and each flow once', () => {
    const flows = uxFlowMembershipsFromElements(
      [
        element({
          id: 'e1',
          diagramId: 'd2',
          diagramName: 'Signup',
          referencesTask: mockupId,
        }),
        element({
          id: 'e2',
          diagramId: 'd1',
          diagramName: 'Checkout',
          referencesTask: mockupId,
        }),
        element({
          id: 'e3',
          diagramId: 'd1',
          diagramName: 'Checkout',
          referencesTask: mockupId,
        }),
      ],
      mockupId,
    );

    expect(flows.map((flow) => flow.diagramName)).toEqual([
      'Checkout',
      'Signup',
    ]);
    expect(flows.find((flow) => flow.diagramId === 'd1')?.elementId).toBe('e2');
  });

  it('returns nothing when no UX flow canonically references the Mockup', () => {
    const flows = uxFlowMembershipsFromElements(
      [
        element({
          id: 'e1',
          diagramId: 'd1',
          diagramName: 'Other flow',
          referencesTask: otherId,
        }),
        element({
          id: 'e2',
          diagramId: 'd2',
          diagramName: 'Architecture',
          kind: 'ARCHITECTURE',
          referencesTask: mockupId,
        }),
        element({
          id: 'e3',
          diagramId: 'd3',
          diagramName: 'Mentions only',
        }),
        element({
          id: 'e4',
          diagramId: 'd4',
          diagramName: 'Service reference',
          referencesTask: mockupId,
          referenceType: 'SERVICE',
        }),
      ],
      mockupId,
    );

    expect(flows).toEqual([]);
  });
});
