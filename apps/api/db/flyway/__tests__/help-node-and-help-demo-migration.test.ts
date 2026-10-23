/**
 * Integration test: V2026.06.19.1 — create help_node and help_demo.
 *
 * Connects to the live Postgres database (DATABASE_URL must be set) and
 * exercises the constraints the SQL declares: the help_demo kind/payload
 * CHECK and the help_node sibling-slug uniqueness (both nested under a
 * parent and at the root, where the partial unique index applies).
 *
 *   jest db/flyway/__tests__/help-node-and-help-demo-migration
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

describe('V2026.06.19.1: help_node and help_demo', () => {
  const prisma = new PrismaClient();

  // A throwaway prefix scopes every row this suite touches so afterAll can
  // delete only what it created without disturbing other test data.
  const slugPrefix = `helptest-${randomUUID()}-`;
  const createdNodeIds: string[] = [];

  const makeSlug = (s: string) => `${slugPrefix}${s}`;

  const createRootNode = async (slug: string) => {
    const node = await prisma.helpNode.create({
      data: {
        slug: makeSlug(slug),
        title: slug,
        ordering: 0,
      },
    });
    createdNodeIds.push(node.id);
    return node;
  };

  afterAll(async () => {
    // Children cascade via the FK, so deleting the roots we created is
    // enough — no need to touch help_demo rows directly.
    if (createdNodeIds.length > 0) {
      await prisma.helpNode.deleteMany({
        where: { id: { in: createdNodeIds } },
      });
    }
    await prisma.$disconnect();
  });

  // ── Schema assertions (catalog-level) ────────────────────────────────────

  it('help_node and help_demo tables exist', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('help_node', 'help_demo')
      ORDER BY table_name
    `;
    expect(rows.map((r) => r.table_name)).toEqual(['help_demo', 'help_node']);
  });

  it('neither table carries organization_id or project_id', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('help_node', 'help_demo')
        AND column_name IN ('organization_id', 'project_id')
    `;
    expect(rows).toEqual([]);
  });

  // ── help_demo kind/payload CHECK ─────────────────────────────────────────

  it('help_demo rejects kind=preset with a non-null definition', async () => {
    const node = await createRootNode('preset-rejects-definition');

    await expect(
      prisma.$executeRaw`
        INSERT INTO "help_demo" ("help_node_id", "ordering", "kind", "preset_key", "definition")
        VALUES (${node.id}::uuid, 0, 'preset', 'scene-a', '{"x":1}'::jsonb)
      `,
    ).rejects.toThrow(/help_demo_payload_check/);
  });

  it('help_demo rejects kind=dsl with a non-null preset_key', async () => {
    const node = await createRootNode('dsl-rejects-preset-key');

    await expect(
      prisma.$executeRaw`
        INSERT INTO "help_demo" ("help_node_id", "ordering", "kind", "preset_key", "definition")
        VALUES (${node.id}::uuid, 0, 'dsl', 'scene-a', '{"x":1}'::jsonb)
      `,
    ).rejects.toThrow(/help_demo_payload_check/);
  });

  it('help_demo rejects kind=preset with a null preset_key', async () => {
    const node = await createRootNode('preset-requires-preset-key');

    await expect(
      prisma.$executeRaw`
        INSERT INTO "help_demo" ("help_node_id", "ordering", "kind", "preset_key", "definition")
        VALUES (${node.id}::uuid, 0, 'preset', NULL, NULL)
      `,
    ).rejects.toThrow(/help_demo_payload_check/);
  });

  it('help_demo rejects kind=dsl with a null definition', async () => {
    const node = await createRootNode('dsl-requires-definition');

    await expect(
      prisma.$executeRaw`
        INSERT INTO "help_demo" ("help_node_id", "ordering", "kind", "preset_key", "definition")
        VALUES (${node.id}::uuid, 0, 'dsl', NULL, NULL)
      `,
    ).rejects.toThrow(/help_demo_payload_check/);
  });

  it('help_demo rejects an unknown kind', async () => {
    const node = await createRootNode('unknown-kind');

    await expect(
      prisma.$executeRaw`
        INSERT INTO "help_demo" ("help_node_id", "ordering", "kind", "preset_key", "definition")
        VALUES (${node.id}::uuid, 0, 'video', 'scene-a', NULL)
      `,
      // A 'video' row also violates help_demo_payload_check (the XOR is keyed
      // off kind), and Postgres surfaces whichever CHECK is evaluated first.
      // Accept either to keep the test independent of constraint order.
    ).rejects.toThrow(/help_demo_(kind|payload)_check/);
  });

  it('help_demo accepts the two valid payload shapes', async () => {
    const node = await createRootNode('valid-payload-shapes');

    const preset = await prisma.helpDemo.create({
      data: {
        helpNodeId: node.id,
        ordering: 0,
        kind: 'preset',
        presetKey: 'scene-a',
      },
    });
    expect(preset.kind).toBe('preset');
    expect(preset.presetKey).toBe('scene-a');
    expect(preset.definition).toBeNull();

    const dsl = await prisma.helpDemo.create({
      data: {
        helpNodeId: node.id,
        ordering: 1,
        kind: 'dsl',
        definition: { steps: [{ op: 'noop' }] },
      },
    });
    expect(dsl.kind).toBe('dsl');
    expect(dsl.presetKey).toBeNull();
    expect(dsl.definition).toEqual({ steps: [{ op: 'noop' }] });
  });

  // ── help_node slug uniqueness ────────────────────────────────────────────

  it('help_node rejects duplicate slugs among non-root siblings', async () => {
    const parent = await createRootNode('sibling-uniq-parent');

    const childSlug = makeSlug('duplicate-child');
    await prisma.helpNode.create({
      data: { parentId: parent.id, slug: childSlug, title: 'first', ordering: 0 },
    });

    await expect(
      prisma.helpNode.create({
        data: { parentId: parent.id, slug: childSlug, title: 'second', ordering: 1 },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('help_node rejects duplicate slugs among roots', async () => {
    const rootSlug = makeSlug('duplicate-root');

    const first = await prisma.helpNode.create({
      data: { slug: rootSlug, title: 'first', ordering: 0 },
    });
    createdNodeIds.push(first.id);

    await expect(
      prisma.helpNode.create({
        data: { slug: rootSlug, title: 'second', ordering: 1 },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('help_node allows the same slug under two different parents', async () => {
    const parentA = await createRootNode('shared-slug-parent-a');
    const parentB = await createRootNode('shared-slug-parent-b');

    const sharedSlug = makeSlug('shared-child');
    await expect(
      prisma.helpNode.create({
        data: { parentId: parentA.id, slug: sharedSlug, title: 'under A', ordering: 0 },
      }),
    ).resolves.toMatchObject({ slug: sharedSlug });
    await expect(
      prisma.helpNode.create({
        data: { parentId: parentB.id, slug: sharedSlug, title: 'under B', ordering: 0 },
      }),
    ).resolves.toMatchObject({ slug: sharedSlug });
  });
});
