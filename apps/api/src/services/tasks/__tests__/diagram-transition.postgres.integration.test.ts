import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../../../prisma/prisma.service';
import type { WorkItemTypeGraphCapability } from '../../../generated';
import { workItemTypeGraphCapabilitySchema } from '../work-item-type-capabilities.schema';

const describeDatabase =
  process.env.RUN_DIAGRAM_DB_TESTS === '1' ? describe : describe.skip;

describeDatabase('Diagram transition traversal SQL', () => {
  const prisma = new PrismaService();
  afterAll(() => prisma.$disconnect());

  it('retains bounded paths for both stored directions and migration states without changing authoring', async () => {
    const statements = readFileSync(
      resolve(
        process.cwd(),
        'db/flyway/V2026.09.13.1__retain_diagram_transition_traversals.sql',
      ),
      'utf8',
    );
    const [definition, updates] = statements.split('$function$;');
    if (!definition || !updates) throw new Error('Migration SQL structure changed');
    const original: WorkItemTypeGraphCapability = {
      nodeChildType: 'workflow_step',
      layout: {
        sectionKey: 'graphLayout',
        schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
      },
      readableRelationships: [],
      editableRelationships: [],
      rendererKey: 'work-item-graph',
      editorKey: 'work-item-graph-editor',
      supportedActions: [],
    };
    await prisma.$transaction(async (tx) => {
      const database = await tx.$queryRawUnsafe<Array<{ name: string }>>(
        'SELECT current_database() AS name',
      );
      expect(database[0]?.name).toMatch(/^hey_hey_wt_/);
      // Temporary tables shadow the real definitions; no stored project data changes.
      for (const table of ['work_item_type_template', 'work_item_type']) {
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE ${table}
          (type_key text, graph_configuration jsonb, updated_at timestamptz) ON COMMIT DROP`);
        for (const typeKey of ['workflow', 'DIAGRAM']) {
          await tx.$executeRawUnsafe(
            `INSERT INTO ${table} (type_key, graph_configuration) VALUES ($1, $2::jsonb)`,
            typeKey,
            JSON.stringify({
              ...original,
              nodeChildType:
                typeKey === 'workflow' ? 'workflow_step' : 'DIAGRAM_ELEMENT',
            }),
          );
        }
      }
      await tx.$executeRawUnsafe(`${definition}$function$;`);
      for (const sql of updates.split(';').filter((value) => value.trim())) {
        await tx.$executeRawUnsafe(sql);
      }
      for (const table of ['work_item_type_template', 'work_item_type']) {
        const rows = await tx.$queryRawUnsafe<
          Array<{ graph_configuration: WorkItemTypeGraphCapability }>
        >(`SELECT graph_configuration FROM ${table}`);
        expect(rows).toHaveLength(2);
        for (const { graph_configuration: graph } of rows) {
          expect(
            workItemTypeGraphCapabilitySchema.safeParse(graph).success,
          ).toBe(true);
          expect(graph.editableRelationships).toEqual(
            original.editableRelationships,
          );
          expect(
            graph.readableRelationships.map((r) => r.edgeType).sort(),
          ).toEqual(['CONSUMES', 'GUARANTEES', 'IMPLEMENTS']);
          expect(graph.readExpansions).toHaveLength(16);
          const paths = graph.readExpansions ?? [];
          expect(new Set(paths.map((p) => p.key)).size).toBe(16);
          for (const first of ['DEPENDS_ON', 'GUARANTEES']) {
            for (const second of ['DEPENDS_ON', 'GUARANTEES']) {
              for (const incoming of ['OUTGOING', 'INCOMING']) {
                for (const outgoing of ['OUTGOING', 'INCOMING']) {
                  expect(
                    paths.some(
                      (p) =>
                        p.path[0]?.relationshipType === first &&
                        p.path[1]?.relationshipType === second &&
                        p.path[0]?.direction === incoming &&
                        p.path[1]?.direction === outgoing,
                    ),
                  ).toBe(true);
                }
              }
            }
          }
          for (const expansion of paths) {
            expect(expansion.limit).toBe(100);
            expect(expansion.excludeRoot).toBe(true);
            expect(expansion.path[1]?.target.workItemTypeKeys).toEqual([
              'workflow_step',
              'DIAGRAM_ELEMENT',
            ]);
            expect(expansion.path[2]?.target.workItemTypeKeys).toEqual([
              'workflow',
              'DIAGRAM',
            ]);
          }
        }
      }
    });
  });
});
