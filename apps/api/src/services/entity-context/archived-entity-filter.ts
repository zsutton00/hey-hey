import type {
  FeatureRequirementRecord,
  FeatureRequirementsSection,
} from '@hey-hey/contracts/api/models';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Returns which of the given entity IDs are archived. Entity IDs are unique
 * across tables, so each archivable table is probed once with the whole batch.
 */
export async function findArchivedEntityIds(
  prisma: PrismaService,
  entityIds: Iterable<string>,
): Promise<Set<string>> {
  const ids = [...new Set(entityIds)];
  if (ids.length === 0) {
    return new Set();
  }

  const where = { id: { in: ids }, archivedAt: { not: null } };
  const select = { id: true };
  const [tasks, designDocs, services] = await Promise.all([
    prisma.db.task.findMany({ where, select }),
    prisma.db.designDoc.findMany({ where, select }),
    prisma.db.service.findMany({ where, select }),
  ]);

  return new Set([...tasks, ...designDocs, ...services].map((row) => row.id));
}

/** IDs of every entity cited by a requirements section. */
export function collectRequirementCitationIds(
  section: FeatureRequirementsSection | undefined,
): string[] {
  return (section?.records ?? []).flatMap((record) =>
    [...record.fulfilledBy, ...record.designedBy, ...record.contracts].map(
      (citation) => citation.entityId,
    ),
  );
}

/**
 * Copy of the section without citations to archived entities. Statements,
 * groups and the remaining citations are unchanged; the stored section is
 * never touched.
 */
export function omitArchivedCitations(
  section: FeatureRequirementsSection,
  archivedIds: ReadonlySet<string>,
): FeatureRequirementsSection {
  const keep = <T extends { entityId: string }>(citations: T[]): T[] =>
    citations.filter((citation) => !archivedIds.has(citation.entityId));

  return {
    ...section,
    records: section.records.map(
      (record): FeatureRequirementRecord => ({
        ...record,
        fulfilledBy: keep(record.fulfilledBy),
        designedBy: keep(record.designedBy),
        contracts: keep(record.contracts),
      }),
    ),
  };
}
