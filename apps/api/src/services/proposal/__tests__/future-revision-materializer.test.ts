import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { FutureRevisionContent } from 'src/generated';
import type { Prisma } from '@prisma/client';
import {
  materializeFutureRevision,
  parseFutureRevisionAuthoring,
  type FutureRevisionMaterializerPorts,
  type FutureTarget,
} from '../future-revision-materializer';
import { parseFutureRevisionMutation } from '../future-revision';

const ORGANIZATION_ID = '20000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000002';
const TARGET_ID = '20000000-0000-4000-8000-000000000003';
const FUTURE_ID = '20000000-0000-4000-8000-000000000004';
const PARENT_ID = '20000000-0000-4000-8000-000000000005';
const WORK_ID = '20000000-0000-4000-8000-000000000006';
const PROVENANCE_ID = '20000000-0000-4000-8000-000000000007';

const TASK_TARGET: FutureTarget = {
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  targetEntityType: 'TASK',
  targetEntityId: TARGET_ID,
};
const DOC_TARGET: FutureTarget = {
  ...TASK_TARGET,
  targetEntityType: 'DESIGN_DOC',
};

function section(key: string, order: number, markdown: string) {
  return {
    id: `20000000-0000-4000-8000-0000000001${order}0`,
    key,
    order,
    materializedMarkdown: markdown,
    materializedProposalId: PROVENANCE_ID,
  };
}

function liveFeature(): Record<string, unknown> {
  return {
    id: TARGET_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    name: 'Live feature',
    type: 'FEATURE',
    status: 'ACTIVE',
    source: 'user',
    config: null,
    initiativeId: null,
    parentTaskId: null,
    assigneeId: null,
    childCounts: { total: 3 },
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    sections: [
      section('description', 0, 'Live description'),
      {
        ...section('requirements', 1, '- Existing requirement'),
        materializedProposalId: '',
      },
    ],
  };
}

const liveDoc = {
  id: TARGET_ID,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  name: 'Live doc',
  template: 'ADR',
  status: 'READY',
  tags: ['a'],
  summary: null,
  parentEntityId: null,
  parentEntityType: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  sections: [
    {
      id: 'doc-s-1',
      key: 'context',
      order: 0,
      materializedMarkdown: 'Context',
    },
    {
      id: 'doc-s-2',
      key: 'decision',
      order: 1,
      materializedMarkdown: 'Decision',
    },
  ],
};

function makePorts(live: Record<string, unknown> = liveFeature()) {
  const ports = {
    readLiveContent: jest
      .fn()
      .mockResolvedValue(live as unknown as FutureRevisionContent),
    readLiveRevision: jest.fn().mockResolvedValue('live-token-1'),
    renderTaskSections: jest.fn(
      (
        _projectId: string,
        _type: string,
        sections: Array<{ key: string; content: unknown }>,
      ) => {
        for (const entry of sections) {
          if (entry.key === 'nope')
            throw new BadRequestException(
              `Unsupported task section key: ${entry.key}`,
            );
        }
        return sections.map((entry) => ({
          key: entry.key,
          content: String(entry.content),
        }));
      },
    ),
    renderRequirementOps: jest.fn(
      async (
        _tx: unknown,
        _target: unknown,
        ops: Array<Record<string, unknown>>,
        baseline: string,
      ) => {
        if (
          ops.some(
            (op) => op.targetId === '99999999-9999-4999-8999-999999999999',
          )
        )
          throw new BadRequestException(
            'requirementOps application failed: unknown targetId',
          );
        return `${baseline}\n- rendered ${ops.map((op) => op.op).join(',')}`;
      },
    ),
  };
  return ports as typeof ports & FutureRevisionMaterializerPorts;
}

function makeTx(
  options: {
    target?: { archivedAt: Date | null } | null;
    future?: Record<string, unknown> | null;
    parent?: Record<string, unknown> | null;
  } = {},
) {
  const target =
    options.target === undefined ? { archivedAt: null } : options.target;
  const futureFindFirst = jest.fn(async (args: { where: { id: string } }) =>
    args.where.id === PARENT_ID
      ? (options.parent ?? null)
      : (options.future ?? null),
  );
  return {
    task: { findFirst: jest.fn().mockResolvedValue(target) },
    designDoc: { findFirst: jest.fn().mockResolvedValue(target) },
    proposalFuture: { findFirst: futureFindFirst },
  } as unknown as Prisma.TransactionClient;
}

function revise(
  changes: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return parseFutureRevisionAuthoring(
    {
      operation: 'REVISE',
      futureId: FUTURE_ID,
      expectedRevision: 0,
      changes,
      ...overrides,
    },
    'TASK',
  );
}

describe('parseFutureRevisionAuthoring', () => {
  it('rejects work-item fields the change shape does not own, addressed under changes', () => {
    expect.assertions(2);
    try {
      revise({ status: 'COMPLETED' });
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const errors = (error as BadRequestException).getResponse() as {
        errors: Array<{ instancePath: string }>;
      };
      expect(errors.errors[0]?.instancePath).toBe('/changes');
    }
  });

  it('narrows changes to the design-doc shape for DESIGN_DOC targets', () => {
    expect(() =>
      parseFutureRevisionAuthoring(
        {
          operation: 'REVISE',
          futureId: FUTURE_ID,
          expectedRevision: 0,
          changes: { requirementOps: [] },
        },
        'DESIGN_DOC',
      ),
    ).toThrow(BadRequestException);
  });
});

describe('materializeFutureRevision', () => {
  it('records the live baseline and revision token for a new future', async () => {
    const ports = makePorts();
    const mutation = await materializeFutureRevision(
      makeTx(),
      ports,
      TASK_TARGET,
      revise(
        { name: 'Future feature' },
        {
          dependencies: [
            {
              edgeType: 'DEPENDS_ON',
              targetEntityType: 'TASK',
              targetEntityId: WORK_ID,
            },
          ],
        },
      ),
    );

    expect(mutation).toMatchObject({
      operation: 'REVISE',
      futureId: FUTURE_ID,
      expectedRevision: 0,
      baseline: { kind: 'LIVE', revision: 'live-token-1' },
      result: { name: 'Future feature' },
      dependencies: [{ targetEntityId: WORK_ID }],
    });
    expect(ports.readLiveRevision.mock.invocationCallOrder[0]).toBeLessThan(
      ports.readLiveContent.mock.invocationCallOrder[0]!,
    );
    // The stored mutation satisfies the unchanged complete-content contract.
    expect(() => parseFutureRevisionMutation(mutation)).not.toThrow();
    if (mutation.operation !== 'REVISE') throw new Error('expected REVISE');
    expect(mutation.baseline.content).not.toHaveProperty('childCounts');
    expect(mutation.baseline.content).not.toHaveProperty('initiativeId');
  });

  it('replaces only the named section and leaves every other field identical to the baseline', async () => {
    const mutation = await materializeFutureRevision(
      makeTx(),
      makePorts(),
      TASK_TARGET,
      revise({
        sections: [{ key: 'description', content: 'Future description' }],
      }),
    );
    if (mutation.operation !== 'REVISE') throw new Error('expected REVISE');
    const { baseline, result } = mutation;
    const { sections: resultSections, ...resultFields } = result;
    const { sections: baselineSections, ...baselineFields } = baseline.content;
    expect(resultFields).toEqual(baselineFields);
    expect(resultSections[0]).toEqual({
      ...baselineSections[0],
      materializedMarkdown: 'Future description',
    });
    expect(resultSections[1]).toEqual(baselineSections[1]);
  });

  it('adds a requirement with no ids and applies ops to the starting requirements', async () => {
    const ports = makePorts();
    const mutation = await materializeFutureRevision(
      makeTx(),
      ports,
      TASK_TARGET,
      revise({
        requirementOps: [{ op: 'add', value: { statement: 'New' } }],
      }),
    );
    expect(ports.renderRequirementOps).toHaveBeenCalledWith(
      expect.anything(),
      TASK_TARGET,
      [{ op: 'add', value: { statement: 'New' } }],
      '- Existing requirement',
    );
    if (mutation.operation !== 'REVISE') throw new Error('expected REVISE');
    expect(
      mutation.result.sections.find((entry) => entry.key === 'requirements')
        ?.materializedMarkdown,
    ).toBe('- Existing requirement\n- rendered add');
  });

  it('updates and deletes requirements by id and rejects an unknown id before persistence', async () => {
    const ports = makePorts();
    await materializeFutureRevision(
      makeTx(),
      ports,
      TASK_TARGET,
      revise({
        requirementOps: [
          {
            op: 'update',
            targetId: '11111111-1111-4111-8111-111111111111',
            statement: 'Changed',
          },
          { op: 'delete', targetId: '22222222-2222-4222-8222-222222222222' },
        ],
      }),
    );
    expect(ports.renderRequirementOps).toHaveBeenCalledTimes(1);

    await expect(
      materializeFutureRevision(
        makeTx(),
        ports,
        TASK_TARGET,
        revise({
          requirementOps: [
            { op: 'delete', targetId: '99999999-9999-4999-8999-999999999999' },
          ],
        }),
      ),
    ).rejects.toThrow(
      /mutation\/changes\/requirementOps: requirementOps application failed/,
    );
  });

  it('copies status, config and source from the baseline', async () => {
    const future = {
      id: FUTURE_ID,
      targetEntityId: TARGET_ID,
      targetEntityType: 'TASK',
      outcome: 'STAGED',
      revision: 1,
      baseline: {
        kind: 'LIVE',
        revision: 'old',
        content: {
          ...liveFeature(),
          status: 'ACTIVE',
          config: { version: 1 },
          source: 'user',
        },
      },
      result: {
        ...liveFeature(),
        status: 'BACKLOG',
        config: { version: 2 },
        source: 'agent',
      },
      dependencies: [],
    };
    const mutation = await materializeFutureRevision(
      makeTx({ future }),
      makePorts(),
      TASK_TARGET,
      revise({ name: 'Refined' }, { expectedRevision: 1 }),
    );
    expect(mutation).toMatchObject({
      result: { status: 'ACTIVE', config: { version: 1 }, source: 'user' },
    });
  });

  it('refines the latest reviewed result and keeps its baseline and dependencies', async () => {
    const ports = makePorts();
    const reviewed = {
      ...liveFeature(),
      sections: [section('description', 0, 'Reviewed future description')],
    };
    const baseline = {
      kind: 'LIVE',
      revision: 'reviewed-token',
      content: liveFeature(),
    };
    const mutation = await materializeFutureRevision(
      makeTx({
        future: {
          id: FUTURE_ID,
          targetEntityId: TARGET_ID,
          targetEntityType: 'TASK',
          outcome: 'STAGED',
          revision: 2,
          baseline,
          result: reviewed,
          dependencies: [{ targetEntityId: WORK_ID }],
        },
      }),
      ports,
      TASK_TARGET,
      revise({ name: 'Refined name' }, { expectedRevision: 2 }),
    );

    expect(ports.readLiveContent).not.toHaveBeenCalled();
    expect(mutation).toMatchObject({
      expectedRevision: 2,
      baseline,
      result: {
        name: 'Refined name',
        sections: [{ materializedMarkdown: 'Reviewed future description' }],
      },
      dependencies: [
        {
          edgeType: 'DEPENDS_ON',
          targetEntityType: 'TASK',
          targetEntityId: WORK_ID,
        },
      ],
    });
  });

  it('builds on a reviewed parent future when one is selected', async () => {
    const parentResult = { ...liveFeature(), name: 'Parent future' };
    const mutation = await materializeFutureRevision(
      makeTx({
        parent: {
          id: PARENT_ID,
          history: [
            {
              revision: 3,
              mutation: { operation: 'REVISE', result: parentResult },
            },
          ],
        },
      }),
      makePorts(),
      TASK_TARGET,
      revise(
        { sections: [{ key: 'description', content: 'On top of parent' }] },
        { baseline: { kind: 'FUTURE', futureId: PARENT_ID, revision: 3 } },
      ),
    );
    expect(mutation).toMatchObject({
      baseline: {
        kind: 'FUTURE',
        futureId: PARENT_ID,
        revision: '3',
        content: parentResult,
      },
      result: { name: 'Parent future' },
    });
  });

  it('materializes design-doc section and field changes against existing keys', async () => {
    const ports = makePorts(liveDoc);
    const mutation = await materializeFutureRevision(
      makeTx(),
      ports,
      DOC_TARGET,
      parseFutureRevisionAuthoring(
        {
          operation: 'REVISE',
          futureId: FUTURE_ID,
          expectedRevision: 0,
          changes: {
            summary: 'Now summarized',
            sections: [{ key: 'decision', content: 'New decision' }],
          },
        },
        'DESIGN_DOC',
      ),
    );
    expect(() => parseFutureRevisionMutation(mutation)).not.toThrow();
    expect(mutation).toMatchObject({
      result: {
        summary: 'Now summarized',
        status: 'READY',
        sections: [
          { key: 'context', materializedMarkdown: 'Context' },
          { key: 'decision', materializedMarkdown: 'New decision' },
        ],
      },
    });
  });

  describe('fail-fast rejections', () => {
    const cases: Array<
      [
        string,
        () => Promise<unknown>,
        RegExp | (new (...args: never[]) => Error),
      ]
    > = [
      [
        'an unknown section key',
        () =>
          materializeFutureRevision(
            makeTx(),
            makePorts(),
            TASK_TARGET,
            revise({ sections: [{ key: 'nope', content: 'x' }] }),
          ),
        /mutation\/changes\/sections: Unsupported task section key: nope/,
      ],
      [
        'a duplicated section key',
        () =>
          materializeFutureRevision(
            makeTx(),
            makePorts(),
            TASK_TARGET,
            revise({
              sections: [
                { key: 'description', content: 'a' },
                { key: 'description', content: 'b' },
              ],
            }),
          ),
        /mutation\/changes\/sections\/1\/key/,
      ],
      [
        'requirementOps on a non-Feature',
        () =>
          materializeFutureRevision(
            makeTx(),
            makePorts({ ...liveFeature(), type: 'CONTRACT' }),
            TASK_TARGET,
            revise({
              requirementOps: [{ op: 'add', value: { statement: 'x' } }],
            }),
          ),
        /only to Features/,
      ],
      [
        'requirementOps combined with sections[requirements]',
        () =>
          materializeFutureRevision(
            makeTx(),
            makePorts(),
            TASK_TARGET,
            revise({
              sections: [{ key: 'requirements', content: '- x' }],
              requirementOps: [{ op: 'add', value: { statement: 'x' } }],
            }),
          ),
        /not both/,
      ],
      [
        'a missing target',
        () =>
          materializeFutureRevision(
            makeTx({ target: null }),
            makePorts(),
            TASK_TARGET,
            revise({ name: 'x' }),
          ),
        NotFoundException,
      ],
      [
        'an archived target',
        () =>
          materializeFutureRevision(
            makeTx({ target: { archivedAt: new Date() } }),
            makePorts(),
            TASK_TARGET,
            revise({ name: 'x' }),
          ),
        /missing or archived/,
      ],
      [
        'an unknown futureId',
        () =>
          materializeFutureRevision(
            makeTx(),
            makePorts(),
            TASK_TARGET,
            revise({ name: 'x' }, { expectedRevision: 1 }),
          ),
        /mutation\/futureId/,
      ],
      [
        'a stale expectedRevision',
        () =>
          materializeFutureRevision(
            makeTx({
              future: {
                id: FUTURE_ID,
                targetEntityId: TARGET_ID,
                targetEntityType: 'TASK',
                outcome: 'STAGED',
                revision: 4,
                dependencies: [],
              },
            }),
            makePorts(),
            TASK_TARGET,
            revise({ name: 'x' }, { expectedRevision: 3 }),
          ),
        ConflictException,
      ],
      [
        'a cancelled parent entry',
        () =>
          materializeFutureRevision(
            makeTx({
              parent: {
                id: PARENT_ID,
                history: [{ revision: 2, mutation: { operation: 'CANCEL' } }],
              },
            }),
            makePorts(),
            TASK_TARGET,
            revise(
              { name: 'x' },
              {
                baseline: { kind: 'FUTURE', futureId: PARENT_ID, revision: 2 },
              },
            ),
          ),
        /mutation\/baseline\/revision/,
      ],
      [
        'an unknown design-doc section',
        () =>
          materializeFutureRevision(
            makeTx(),
            makePorts(liveDoc),
            DOC_TARGET,
            parseFutureRevisionAuthoring(
              {
                operation: 'REVISE',
                futureId: FUTURE_ID,
                expectedRevision: 0,
                changes: { sections: [{ key: 'risks', content: 'x' }] },
              },
              'DESIGN_DOC',
            ),
          ),
        /mutation\/changes\/sections\/0\/key/,
      ],
    ];

    it.each(cases)('rejects %s', async (_name, run, expected) => {
      await expect(run()).rejects.toThrow(expected);
    });
  });

  it('passes a cancellation through unchanged', async () => {
    const cancel = parseFutureRevisionAuthoring(
      { operation: 'CANCEL', futureId: FUTURE_ID, expectedRevision: 2 },
      'TASK',
    );
    const tx = makeTx();
    await expect(
      materializeFutureRevision(tx, makePorts(), TASK_TARGET, cancel),
    ).resolves.toEqual(cancel);
  });
});
