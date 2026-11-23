import { AgentEdgeType } from 'src/generated/graphs/model/agentEdgeType';
import {
  DIAGRAM_ELEMENT_LOOKUP_LIMITS,
  DiagramElementLookupService,
} from '../diagram-element-lookup.service';

const ORG = '11111111-1111-4111-8111-111111111111' as never;
const PROJECT = '22222222-2222-4222-8222-222222222222' as never;
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const SERVICE_ID = '44444444-4444-4444-8444-444444444444';
const CONTRACT_ID = '55555555-5555-4555-8555-555555555555';
const ELEMENT_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_ELEMENT_ID = '77777777-7777-4777-8777-777777777777';

const row = (id: string, name: string, metadata?: object) => ({
  id,
  name,
  sections: metadata
    ? [
        {
          materializedMarkdown: JSON.stringify({
            role: 'GENERIC',
            ...metadata,
          }),
        },
      ]
    : [],
  parentTask: { id: `diagram-of-${id}`, name: `Diagram for ${name}` },
});

function build(options: {
  /** Rows returned for the canonical-reference narrowing query. */
  mentioning?: unknown[];
  contracts?: string[];
  elementsById?: unknown[];
  edges?: unknown[];
  edgeError?: Error;
}) {
  // Call order is part of the service's contract with the store: canonical
  // narrowing, then (only when a participation edge exists) Contract check,
  // then the edge-sourced elements.
  const findMany = jest.fn().mockResolvedValueOnce(options.mentioning ?? []);
  if (options.contracts) {
    findMany.mockResolvedValueOnce(options.contracts.map((id) => ({ id })));
  }
  findMany.mockResolvedValueOnce(options.elementsById ?? []);

  const findIncident = options.edgeError
    ? jest.fn().mockRejectedValue(options.edgeError)
    : jest.fn().mockResolvedValue(options.edges ?? []);

  return {
    findMany,
    service: new DiagramElementLookupService(
      { db: { task: { findMany } } } as never,
      { findIncident } as never,
    ),
    findIncident,
  };
}

const identities = [
  { entityType: 'TASK' as const, entityId: TASK_ID },
  { entityType: 'SERVICE' as const, entityId: SERVICE_ID },
  { entityType: 'TASK' as const, entityId: CONTRACT_ID },
];

describe('DiagramElementLookupService', () => {
  it('finds an element through its canonical reference, task or Service', async () => {
    const { service } = build({
      mentioning: [
        row(ELEMENT_ID, 'Advance state', {
          canonicalReference: { entityType: 'SERVICE', entityId: SERVICE_ID },
        }),
        row(OTHER_ELEMENT_ID, 'Plan step', {
          canonicalReference: { entityType: 'TASK', entityId: TASK_ID },
        }),
      ],
    });

    const result = await service.find(ORG, PROJECT, identities, 'token');

    expect(result.truncated).toBe(false);
    expect(
      result.hits.map((hit) => [
        hit.element.id,
        hit.linkKind,
        hit.identity.entityId,
      ]),
    ).toEqual([
      [ELEMENT_ID, 'CANONICAL_REFERENCE', SERVICE_ID],
      [OTHER_ELEMENT_ID, 'CANONICAL_REFERENCE', TASK_ID],
    ]);
  });

  it('ignores an element that only mentions the id without canonically referencing it', async () => {
    const { service } = build({
      mentioning: [
        row(ELEMENT_ID, 'Mentions in prose', {
          canonicalReference: {
            entityType: 'TASK',
            entityId: '99999999-9999-4999-8999-999999999999',
          },
        }),
        // Same id but a different entity type is a different entity.
        row(OTHER_ELEMENT_ID, 'Wrong type', {
          canonicalReference: { entityType: 'SERVICE', entityId: TASK_ID },
        }),
      ],
    });

    const result = await service.find(ORG, PROJECT, identities, 'token');

    expect(result.hits).toEqual([]);
  });

  it('returns FULFILLED_BY and each Contract participation type, but not a plain relation to a Contract', async () => {
    const edge = (
      id: string,
      type: string,
      source: string,
      target: string,
    ) => ({
      id,
      type,
      sourceNodeId: source,
      targetNodeId: target,
    });
    const { service } = build({
      contracts: [CONTRACT_ID],
      elementsById: [
        row(ELEMENT_ID, 'Provider', { role: 'GENERIC' }),
        row(OTHER_ELEMENT_ID, 'Consumer'),
      ],
      edges: [
        edge('e1', AgentEdgeType.FulfilledBy, ELEMENT_ID, TASK_ID),
        edge('e2', AgentEdgeType.Implements, ELEMENT_ID, CONTRACT_ID),
        edge('e3', AgentEdgeType.Consumes, OTHER_ELEMENT_ID, CONTRACT_ID),
        edge('e4', AgentEdgeType.Guarantees, OTHER_ELEMENT_ID, TASK_ID),
        edge('e5', AgentEdgeType.RelatedTo, OTHER_ELEMENT_ID, TASK_ID),
      ],
    });

    const result = await service.find(ORG, PROJECT, identities, 'token');

    expect(
      result.hits.map((hit) => [
        hit.element.id,
        hit.linkKind,
        hit.relationshipType,
      ]),
    ).toEqual([
      [ELEMENT_ID, 'FULFILLED_BY', undefined],
      [ELEMENT_ID, 'CONTRACT_PARTICIPATION', 'IMPLEMENTS'],
      [OTHER_ELEMENT_ID, 'CONTRACT_PARTICIPATION', 'CONSUMES'],
    ]);
  });

  it('drops an edge whose element is archived or in an archived Diagram', async () => {
    const { service } = build({
      elementsById: [],
      edges: [
        {
          id: 'e1',
          type: AgentEdgeType.FulfilledBy,
          sourceNodeId: ELEMENT_ID,
          targetNodeId: TASK_ID,
        },
      ],
    });

    const result = await service.find(ORG, PROJECT, identities, 'token');

    expect(result.hits).toEqual([]);
  });

  it('finds a canonical reference that sits behind a full page of incidental mentions', async () => {
    const incidental = Array.from(
      { length: DIAGRAM_ELEMENT_LOOKUP_LIMITS.candidatePageSize },
      (_, index) =>
        row(`noise-${index}`, `Noise ${index}`, {
          canonicalReference: {
            entityType: 'TASK',
            entityId: '99999999-9999-4999-8999-999999999999',
          },
        }),
    );
    const real = row(ELEMENT_ID, 'Advance state', {
      canonicalReference: { entityType: 'SERVICE', entityId: SERVICE_ID },
    });
    const { service, findMany } = build({ mentioning: incidental });
    findMany.mockReset();
    findMany
      .mockResolvedValueOnce(incidental)
      .mockResolvedValueOnce([real])
      .mockResolvedValueOnce([]);

    const result = await service.find(ORG, PROJECT, identities, 'token');

    expect(result.truncated).toBe(false);
    expect(result.hits.map((hit) => hit.element.id)).toEqual([ELEMENT_ID]);
    expect(findMany.mock.calls[1][0]).toMatchObject({
      cursor: { id: 'noise-199' },
      skip: 1,
    });
  });

  it('reports truncation at the hit limit', async () => {
    const many = Array.from(
      { length: DIAGRAM_ELEMENT_LOOKUP_LIMITS.hitCount + 1 },
      (_, index) =>
        row(`element-${index}`, `Element ${index}`, {
          canonicalReference: { entityType: 'TASK', entityId: TASK_ID },
        }),
    );
    const { service } = build({ mentioning: many });

    const result = await service.find(ORG, PROJECT, identities, 'token');

    expect(result.truncated).toBe(true);
    expect(result.hits).toHaveLength(DIAGRAM_ELEMENT_LOOKUP_LIMITS.hitCount);
  });

  it('fails instead of returning an empty result when the graph read fails', async () => {
    const { service } = build({ edgeError: new Error('graph unavailable') });

    await expect(
      service.find(ORG, PROJECT, identities, 'token'),
    ).rejects.toThrow('graph unavailable');
  });
});
