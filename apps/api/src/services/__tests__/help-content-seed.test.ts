/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { HelpSourceNode } from '../help-content-source';
import { hashHelpNode, seedHelpContent } from '../help-content-seed';

const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const DEMO_ID = '33333333-3333-4333-8333-333333333333';

describe('seedHelpContent', () => {
  it('hashes canonical Help content independently of object insertion order and locale collation', () => {
    const first = canonicalHashFixture({ z: 1, ä: 2 });
    const second = canonicalHashFixture({ ä: 2, z: 1 });

    expect(hashHelpNode(first)).toBe(hashHelpNode(second));
    expect(hashHelpNode(first)).toBe(
      '5d8ae27aa3a5fa0f7834412455ff94b29d1978053b6c89fcc9bcfc38c170cde0',
    );
  });

  it('bootstraps stable identities, publishes canonical snapshots, and is a no-op on rerun', async () => {
    const store = createStore();
    const source = sourceTree();

    await expect(run(store, source)).resolves.toMatchObject({
      nodes: { created: 2, updated: 0, unchanged: 0 },
      demos: { created: 1, updated: 0, deleted: 0, unchanged: 0 },
      changedNodeIds: [ROOT_ID, CHILD_ID].sort(),
      drift: [],
    });
    expect(store.nodes.map((node: NodeRow) => node.id).sort()).toEqual(
      [ROOT_ID, CHILD_ID].sort(),
    );
    expect(store.events).toHaveLength(2);
    expect(store.events[0]).toMatchObject({
      type: 'help.content_changed',
      payload: { payloadType: 'help.content_changed' },
    });
    for (const event of store.events) {
      expect(event.payload.contentHash).toBe(
        hashHelpNode(event.payload.helpNode),
      );
    }

    store.events.length = 0;
    await expect(run(store, source)).resolves.toMatchObject({
      nodes: { created: 0, updated: 0, unchanged: 2 },
      demos: { created: 0, updated: 0, deleted: 0, unchanged: 1 },
      changedNodeIds: [],
      drift: [],
    });
    expect(store.events).toEqual([]);
  });

  it('applies moves and demo replacement with one final event per affected node', async () => {
    const store = createStore();
    const source = sourceTree();
    await run(store, source);
    store.events.length = 0;

    const changed = sourceTree();
    const child = changed[1]!;
    child.parentId = null;
    child.ordering = 2;
    child.body = 'Moved body';
    changed[0]!.demos = [
      {
        id: DEMO_ID,
        kind: 'dsl',
        ordering: 1,
        caption: 'Replacement',
        definition: { steps: [] },
      },
    ];

    const summary = await run(store, changed);
    expect(summary.nodes.updated).toBe(1);
    expect(summary.demos.updated).toBe(1);
    expect(summary.changedNodeIds).toEqual([ROOT_ID, CHILD_ID].sort());
    expect(store.events).toHaveLength(2);
    expect(
      store.events.find(
        (event: PublishedEvent) => event.aggregateId === ROOT_ID,
      )?.payload.helpNode.demos,
    ).toEqual([
      {
        id: DEMO_ID,
        kind: 'dsl',
        ordering: 1,
        caption: 'Replacement',
        definition: { steps: [] },
      },
    ]);
  });

  it('adopts the predecessor seed rows once, then reconciles by source identity', async () => {
    const store = createStore({
      nodes: sourceTree().map(({ demos: _demos, ...node }, index) => ({
        ...node,
        id:
          index === 0
            ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
            : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        parentId: index === 0 ? null : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      })),
    });

    const summary = await run(store, sourceTree());

    expect(summary.nodes).toEqual({ created: 0, updated: 2, unchanged: 0 });
    expect(store.nodes.map((node: NodeRow) => node.id).sort()).toEqual(
      [ROOT_ID, CHILD_ID].sort(),
    );
    expect(
      store.nodes.find((node: NodeRow) => node.id === CHILD_ID)?.parentId,
    ).toBe(ROOT_ID);
    expect(summary.drift).toEqual([]);
  });

  it('deletes removed demos only from source-managed nodes and reports database-only nodes as drift', async () => {
    const store = createStore({
      nodes: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          parentId: null,
          slug: 'database-only',
          title: 'Database only',
          body: 'Keep',
          ordering: 20,
        },
      ],
      demos: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          helpNodeId: '44444444-4444-4444-8444-444444444444',
          ordering: 1,
          caption: 'Keep',
          kind: 'dsl',
          presetKey: null,
          definition: { keep: true },
        },
      ],
    });
    await run(store, sourceTree());
    store.events.length = 0;

    const changed = sourceTree();
    changed[0]!.demos = [];
    const summary = await run(store, changed);

    expect(summary.demos.deleted).toBe(1);
    expect(summary.drift).toEqual([
      {
        id: '44444444-4444-4444-8444-444444444444',
        slugPath: 'database-only',
      },
    ]);
    expect(
      store.nodes.some((node: NodeRow) => node.slug === 'database-only'),
    ).toBe(true);
    expect(store.demos.some((demo: DemoRow) => demo.caption === 'Keep')).toBe(
      true,
    );
    expect(store.events).toHaveLength(1);
  });

  it('rolls back content and events when publication fails', async () => {
    const store = createStore();
    store.publishError = new Error('outbox unavailable');

    await expect(run(store, sourceTree())).rejects.toThrow(
      'outbox unavailable',
    );
    expect(store.nodes).toEqual([]);
    expect(store.demos).toEqual([]);
    expect(store.events).toEqual([]);
  });

  it('takes the transaction-scoped advisory lock before reading content', async () => {
    const store = createStore();
    await run(store, sourceTree());
    expect(store.calls[0]).toBe('lock');
    expect(store.calls.filter((call: string) => call === 'lock')).toHaveLength(
      1,
    );
  });
});

function canonicalHashFixture(definition: Record<string, unknown>) {
  return {
    id: ROOT_ID,
    parentId: null,
    slug: 'root',
    title: 'Root',
    ordering: 1,
    body: 'Root body',
    demos: [
      {
        id: DEMO_ID,
        ordering: 1,
        caption: 'DSL',
        kind: 'dsl' as const,
        definition,
      },
    ],
  };
}

function sourceTree(): HelpSourceNode[] {
  return [
    {
      id: ROOT_ID,
      parentId: null,
      slug: 'root',
      title: 'Root',
      body: 'Root body',
      ordering: 1,
      demos: [
        {
          id: DEMO_ID,
          kind: 'preset',
          ordering: 1,
          caption: 'Tour',
          presetKey: 'tour',
        },
      ],
    },
    {
      id: CHILD_ID,
      parentId: ROOT_ID,
      slug: 'child',
      title: 'Child',
      body: 'Child body',
      ordering: 1,
      demos: [],
    },
  ];
}

type NodeRow = Omit<HelpSourceNode, 'demos'>;
type DemoRow = {
  id: string;
  helpNodeId: string;
  ordering: number;
  caption: string;
  kind: string;
  presetKey: string | null;
  definition: unknown;
};
type PublishedEvent = {
  aggregateId: string;
  payload: {
    helpNode: Parameters<typeof hashHelpNode>[0];
    contentHash: string;
  };
};

function createStore(input: { nodes?: NodeRow[]; demos?: DemoRow[] } = {}) {
  const nodes = [...(input.nodes ?? [])];
  const demos = [...(input.demos ?? [])];
  const calls: string[] = [];
  const events: any[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => {
      calls.push('lock');
      return [{ lockAcquired: '' }];
    }),
    helpNode: {
      findMany: jest.fn(async (args: any) => {
        calls.push('findNodes');
        const rows = args?.where?.id?.in
          ? nodes.filter((node) => args.where.id.in.includes(node.id))
          : nodes;
        return args?.include
          ? rows.map((node) => ({
              ...node,
              demos: demos
                .filter((demo) => demo.helpNodeId === node.id)
                .sort((a, b) => a.ordering - b.ordering),
            }))
          : rows.map((node) => ({ ...node }));
      }),
      create: jest.fn(async ({ data }: any) => {
        nodes.push({ ...data });
        return { ...data };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = nodes.findIndex((node) => node.id === where.id);
        nodes[index] = { ...nodes[index]!, ...data };
        return { ...nodes[index]! };
      }),
    },
    helpDemo: {
      findMany: jest.fn(async ({ where }: any) =>
        demos
          .filter((demo) => where.helpNodeId.in.includes(demo.helpNodeId))
          .map((demo) => ({ ...demo })),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          ...data,
          definition: data.kind === 'preset' ? null : data.definition,
        };
        demos.push(row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = demos.findIndex((demo) => demo.id === where.id);
        demos[index] = { ...demos[index]!, ...data };
        if (data.kind === 'preset') demos[index]!.definition = null;
        return { ...demos[index]! };
      }),
      delete: jest.fn(async ({ where }: any) => {
        const index = demos.findIndex((demo) => demo.id === where.id);
        return demos.splice(index, 1)[0];
      }),
    },
  };

  const store: any = {
    nodes,
    demos,
    calls,
    events,
    publishError: undefined,
    prisma: {
      $transaction: jest.fn(async (callback: any) => {
        const nodeSnapshot = nodes.map((node) => ({ ...node }));
        const demoSnapshot = demos.map((demo) => ({ ...demo }));
        const eventCount = events.length;
        try {
          return await callback(tx);
        } catch (error) {
          nodes.splice(0, nodes.length, ...nodeSnapshot);
          demos.splice(0, demos.length, ...demoSnapshot);
          events.splice(eventCount);
          throw error;
        }
      }),
    },
    publisher: {
      publishInTransaction: jest.fn(async (_tx: unknown, event: any) => {
        if (store.publishError) throw store.publishError;
        events.push(event);
        return `event-${events.length}`;
      }),
    },
  };
  return store;
}

function run(
  store: ReturnType<typeof createStore>,
  sourceNodes: HelpSourceNode[],
) {
  return seedHelpContent(store.prisma, {
    sourceNodes,
    eventPublisher: store.publisher,
  });
}
