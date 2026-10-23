import { InternalServerErrorException } from '@nestjs/common';
import { HelpService } from '../help.service';
import { buildHelpTreeItems, HelpNodeTreeRow } from '../help-tree.util';

const now = new Date('2026-06-30T00:00:00.000Z');

describe('HelpService', () => {
  it('serves GET /help/tree data from help_node rows in tree order', async () => {
    const rows: HelpNodeTreeRow[] = [
      {
        id: 'root-b',
        parentId: null,
        slug: 'root-b',
        title: 'Root B',
        ordering: 2,
      },
      {
        id: 'child-b',
        parentId: 'root-a',
        slug: 'child-b',
        title: 'Child B',
        ordering: 2,
      },
      {
        id: 'root-a',
        parentId: null,
        slug: 'root-a',
        title: 'Root A',
        ordering: 1,
      },
      {
        id: 'child-a',
        parentId: 'root-a',
        slug: 'child-a',
        title: 'Child A',
        ordering: 1,
      },
    ];
    const prisma = {
      helpNode: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    };
    const service = new HelpService(prisma as never);

    await expect(service.getTree()).resolves.toEqual({
      items: [
        rows[2],
        rows[3],
        rows[1],
        rows[0],
      ],
    });
    expect(prisma.helpNode.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        parentId: true,
        slug: true,
        title: true,
        ordering: true,
      },
    });
  });

  it('resolves a node by UUID with body and ordered discriminated demos', async () => {
    const node = makeHelpNodeWithDemosRow({
      id: '11111111-1111-4111-8111-111111111111',
      demos: [
        makeHelpDemoRow({
          id: 'demo-dsl',
          ordering: 1,
          caption: 'DSL caption',
          kind: 'dsl',
          presetKey: null,
          definition: { steps: [] },
        }),
        makeHelpDemoRow({
          id: 'demo-preset',
          ordering: 2,
          caption: 'Preset caption',
          kind: 'preset',
          presetKey: 'feature-tour',
          definition: null,
        }),
      ],
    });
    const prisma = {
      helpNode: {
        findUnique: jest.fn().mockResolvedValue(node),
        findMany: jest.fn(),
      },
    };
    const service = new HelpService(prisma as never);

    await expect(service.findByIdOrSlugPath(node.id)).resolves.toEqual({
      id: node.id,
      parentId: null,
      slug: 'root',
      title: 'Root',
      ordering: 1,
      body: 'Root body',
      demos: [
        {
          id: 'demo-dsl',
          ordering: 1,
          caption: 'DSL caption',
          kind: 'dsl',
          definition: { steps: [] },
        },
        {
          id: 'demo-preset',
          ordering: 2,
          caption: 'Preset caption',
          kind: 'preset',
          presetKey: 'feature-tour',
        },
      ],
    });
    expect(prisma.helpNode.findUnique).toHaveBeenCalledWith({
      where: { id: node.id },
      include: {
        demos: {
          orderBy: { ordering: 'asc' },
        },
      },
    });
    expect(prisma.helpNode.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty search result set for whitespace queries without querying', async () => {
    const prisma = {
      $queryRaw: jest.fn(),
      helpNode: {
        findMany: jest.fn(),
      },
    };
    const service = new HelpService(prisma as never);

    await expect(service.searchHelpNodes('   \n\t  ')).resolves.toEqual({
      results: [],
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('searches help_node title and body with ranked snippets only', async () => {
    const rows = [
      {
        id: '22222222-2222-4222-8222-222222222222',
        slug: 'higher-rank',
        title: 'Higher Rank',
        snippet: 'Matched body <b>content</b>',
        rank: 0.81,
      },
      {
        id: '11111111-1111-4111-8111-111111111111',
        slug: 'lower-rank',
        title: 'Lower Rank',
        snippet: 'Matched title',
        rank: '0.42',
      },
    ];
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(rows),
      helpNode: {
        findMany: jest.fn(),
      },
    };
    const service = new HelpService(prisma as never);

    const result = await service.searchHelpNodes('  content  ', 25);

    expect(result).toEqual({
      results: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          slug: 'higher-rank',
          title: 'Higher Rank',
          snippet: 'Matched body <b>content</b>',
          rank: 0.81,
        },
        {
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'lower-rank',
          title: 'Lower Rank',
          snippet: 'Matched title',
          rank: 0.42,
        },
      ],
    });
    expect(Object.keys(result.results[0] ?? {}).sort()).toEqual([
      'id',
      'rank',
      'slug',
      'snippet',
      'title',
    ]);

    const query = prisma.$queryRaw.mock.calls[0]?.[0];
    expect(query.sql).toContain('FROM "help_node" hn');
    expect(query.sql).toContain('ORDER BY rank DESC');
    expect(query.sql).toContain('ts_headline');
    expect(query.sql).not.toContain('help_demo');
    expect(query.values).toEqual(['content', 25]);
  });

  it('fails fast when a search row is missing its snippet', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'missing-snippet',
          title: 'Missing Snippet',
          snippet: null,
          rank: 0.2,
        },
      ]),
      helpNode: {
        findMany: jest.fn(),
      },
    };
    const service = new HelpService(prisma as never);

    await expect(service.searchHelpNodes('snippet')).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('walks a multi-segment slug path from the root', async () => {
    const node = makeHelpNodeWithDemosRow({
      id: '33333333-3333-4333-8333-333333333333',
      parentId: '22222222-2222-4222-8222-222222222222',
      slug: 'child',
      title: 'Child',
      body: 'Child body',
      demos: [],
    });
    const prisma = {
      helpNode: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { id: '22222222-2222-4222-8222-222222222222' },
          ])
          .mockResolvedValueOnce([
            { id: '33333333-3333-4333-8333-333333333333' },
          ]),
        findUnique: jest.fn().mockResolvedValue(node),
      },
    };
    const service = new HelpService(prisma as never);

    await expect(service.findByIdOrSlugPath('root/child')).resolves.toEqual({
      id: node.id,
      parentId: '22222222-2222-4222-8222-222222222222',
      slug: 'child',
      title: 'Child',
      ordering: 1,
      body: 'Child body',
      demos: [],
    });
    expect(prisma.helpNode.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        parentId: null,
        slug: 'root',
      },
      select: {
        id: true,
      },
      take: 2,
    });
    expect(prisma.helpNode.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        parentId: '22222222-2222-4222-8222-222222222222',
        slug: 'child',
      },
      select: {
        id: true,
      },
      take: 2,
    });
    expect(prisma.helpNode.findUnique).toHaveBeenCalledWith({
      where: { id: node.id },
      include: {
        demos: {
          orderBy: { ordering: 'asc' },
        },
      },
    });
  });

  it('returns null when a slug segment does not resolve', async () => {
    const prisma = {
      helpNode: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
    };
    const service = new HelpService(prisma as never);

    await expect(service.findByIdOrSlugPath('missing/path')).resolves.toBeNull();
    expect(prisma.helpNode.findUnique).not.toHaveBeenCalled();
  });

  it('fails fast when a preset demo row is missing presetKey', async () => {
    const node = makeHelpNodeWithDemosRow({
      demos: [
        makeHelpDemoRow({
          id: 'bad-demo',
          kind: 'preset',
          presetKey: null,
          definition: null,
        }),
      ],
    });
    const prisma = {
      helpNode: {
        findUnique: jest.fn().mockResolvedValue(node),
        findMany: jest.fn(),
      },
    };
    const service = new HelpService(prisma as never);

    await expect(service.findByIdOrSlugPath(node.id)).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('fails fast when slug lookup finds duplicate siblings', async () => {
    const prisma = {
      helpNode: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'node-a' }, { id: 'node-b' }]),
        findUnique: jest.fn(),
      },
    };
    const service = new HelpService(prisma as never);

    await expect(service.findByIdOrSlugPath('root')).rejects.toThrow(
      InternalServerErrorException,
    );
    expect(prisma.helpNode.findUnique).not.toHaveBeenCalled();
  });
});

describe('buildHelpTreeItems', () => {
  it('fails when rows do not form a rooted tree', () => {
    expect(() =>
      buildHelpTreeItems([
        {
          id: 'node-a',
          parentId: 'node-b',
          slug: 'node-a',
          title: 'Node A',
          ordering: 1,
        },
        {
          id: 'node-b',
          parentId: 'node-a',
          slug: 'node-b',
          title: 'Node B',
          ordering: 1,
        },
      ]),
    ).toThrow(InternalServerErrorException);
  });
});

function makeHelpNodeWithDemosRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    parentId: null,
    slug: 'root',
    title: 'Root',
    body: 'Root body',
    ordering: 1,
    createdAt: now,
    updatedAt: now,
    demos: [],
    ...overrides,
  };
}

function makeHelpDemoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'demo-1',
    helpNodeId: '11111111-1111-4111-8111-111111111111',
    ordering: 1,
    caption: 'Caption',
    kind: 'preset',
    presetKey: 'preset-key',
    definition: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
