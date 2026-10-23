import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  extractHelpImageDestinations,
  HelpSourceNode,
  loadHelpContentSource,
  normalizeHelpAssetReference,
  parseHelpContentFile,
  validateHelpContentSource,
} from '../help-content-source';

const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const DEMO_ID = '33333333-3333-4333-8333-333333333333';
const MY_FIRST_PROJECT_ID = 'e39a7dfd-9a36-466e-848a-23d9082404ea';

describe('Help content source', () => {
  it('loads the source-controlled Help catalog as an acyclic ordered tree', async () => {
    const nodes = await loadHelpContentSource();
    expect(nodes).toHaveLength(26);
    expect(
      nodes
        .filter((node) => node.parentId === null)
        .sort((a, b) => a.ordering - b.ordering)
        .map((node) => node.slug),
    ).toEqual([
      'install-agent-bridge',
      'features-ready',
      'create-a-service',
      'create-a-task',
      'first-agent-session',
      'my-first-project',
    ]);
    expect(
      nodes
        .filter((node) => node.parentId === MY_FIRST_PROJECT_ID)
        .sort((a, b) => a.ordering - b.ordering)
        .map((node) => node.slug),
    ).toEqual([
      'living-project',
      'shape-feature-tree',
      'turn-question-into-work',
      'plan-larger-outcome',
      'choose-coding-session',
      'grow-shared-understanding',
      'ask-effectively',
    ]);
    expect(nodes.flatMap((node) => node.demos)).toHaveLength(4);
  });

  it('parses strict frontmatter and preset demos', () => {
    expect(
      parseHelpContentFile(
        'root.md',
        `---\nid: ${ROOT_ID}\nslug: root\ntitle: Root\nparentId: null\nordering: 1\ndemos:\n  - id: ${DEMO_ID}\n    kind: preset\n    ordering: 1\n    caption: Tour\n    presetKey: tour\n---\nBody\n`,
      ),
    ).toEqual({
      id: ROOT_ID,
      slug: 'root',
      title: 'Root',
      parentId: null,
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
      body: 'Body',
    });
  });

  it.each([
    ['missing delimiters', 'id: nope', /expected YAML frontmatter/],
    ['malformed YAML', '---\nid: [\n---\nBody', /malformed YAML frontmatter/],
    [
      'extra field',
      `---\nid: ${ROOT_ID}\nslug: root\ntitle: Root\nparentId: null\nordering: 1\ndemos: []\nextra: true\n---\nBody`,
      /must contain exactly/,
    ],
    [
      'invalid DSL definition',
      `---\nid: ${ROOT_ID}\nslug: root\ntitle: Root\nparentId: null\nordering: 1\ndemos:\n  - id: ${DEMO_ID}\n    kind: dsl\n    ordering: 1\n    caption: DSL\n    definition: []\n---\nBody`,
      /definition must be an object/,
    ],
    [
      'demo ordering gap',
      `---\nid: ${ROOT_ID}\nslug: root\ntitle: Root\nparentId: null\nordering: 1\ndemos:\n  - id: ${DEMO_ID}\n    kind: preset\n    ordering: 2\n    caption: Tour\n    presetKey: tour\n---\nBody`,
      /demo ordering must be unique and contiguous/,
    ],
  ])('rejects %s', (_label, source, expected) => {
    expect(() => parseHelpContentFile('bad.md', source)).toThrow(expected);
  });

  it.each([
    [
      'duplicate ids',
      [node(), node({ slug: 'other', ordering: 2 })],
      /Duplicate Help node id/,
    ],
    [
      'duplicate slugs',
      [node(), node({ id: CHILD_ID, ordering: 2 })],
      /Duplicate Help node slug/,
    ],
    [
      'missing parents',
      [node({ parentId: CHILD_ID })],
      /references missing parent/,
    ],
    [
      'cycles',
      [
        node({ parentId: CHILD_ID }),
        node({ id: CHILD_ID, slug: 'child', parentId: ROOT_ID }),
      ],
      /contains a cycle/,
    ],
    [
      'sibling ordering collisions',
      [node(), node({ id: CHILD_ID, slug: 'child' })],
      /sibling ordering.*unique and contiguous/,
    ],
    [
      'sibling ordering gaps',
      [node(), node({ id: CHILD_ID, slug: 'child', ordering: 3 })],
      /sibling ordering.*unique and contiguous/,
    ],
  ])('rejects %s across the complete source set', (_label, nodes, expected) => {
    expect(() => validateHelpContentSource(nodes as HelpSourceNode[])).toThrow(
      expected,
    );
  });

  it('extracts image destinations while preserving the Markdown body', () => {
    const body = [
      '![Overview](assets/overview.svg "Caption")',
      '',
      '![Nested](<assets/nested/diagram.png>)',
    ].join('\n');

    expect(extractHelpImageDestinations(body)).toEqual([
      'assets/overview.svg',
      'assets/nested/diagram.png',
    ]);
    expect(normalizeHelpAssetReference('assets/overview.svg')).toBe(
      'assets/overview.svg',
    );
  });

  it('accepts a checked-in image and preserves its authored Markdown body', async () => {
    const nodes = await withHelpFixture('assets/image.png', true);

    expect(nodes[0]?.body).toBe('![Image](assets/image.png)');
  });

  it('rejects missing repository images before loading the source', async () => {
    await expect(withHelpFixture('assets/missing.png', false)).rejects.toThrow(
      /Help image asset not found/,
    );
  });

  it('rejects repository files that are not supported image assets', async () => {
    await expect(
      withHelpFixture('assets/image.txt', true, 'image.txt'),
    ).rejects.toThrow(/Help image asset is not a supported image/);
  });

  it.each([
    ['absolute references', '/tmp/image.png'],
    ['remote references', 'https://example.com/image.png'],
    ['path traversal', 'assets/../outside.png'],
    ['encoded path traversal', 'assets/%2e%2e/outside.png'],
  ])('rejects %s in repository images', async (_label, reference) => {
    await expect(withHelpFixture(reference, true)).rejects.toThrow(
      /Help image reference/,
    );
  });
});

function node(overrides: Partial<HelpSourceNode> = {}): HelpSourceNode {
  return {
    id: ROOT_ID,
    slug: 'root',
    title: 'Root',
    parentId: null,
    ordering: 1,
    demos: [],
    body: 'Body',
    ...overrides,
  };
}

async function withHelpFixture(
  reference: string,
  includeAsset: boolean,
  assetFileName = 'image.png',
): Promise<HelpSourceNode[]> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'heyhey-help-content-'),
  );
  const assetsDirectory = path.join(directory, 'assets');
  await fs.mkdir(assetsDirectory);
  await fs.writeFile(
    path.join(directory, 'root.md'),
    `---\nid: ${ROOT_ID}\nslug: root\ntitle: Root\nparentId: null\nordering: 1\ndemos: []\n---\n![Image](${reference})\n`,
  );
  if (includeAsset) {
    await fs.writeFile(path.join(assetsDirectory, assetFileName), 'image');
  }

  try {
    return await loadHelpContentSource(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
