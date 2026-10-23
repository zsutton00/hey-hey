import type { AnyTransactionClient } from 'src/prisma/prisma.service';

type TargetRow = Record<string, unknown> & {
  sections: Array<{ key: string; materializedMarkdown: string | null }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadTarget(
  tx: AnyTransactionClient,
  targetEntityType: string,
  targetEntityId: string,
): Promise<TargetRow | null> {
  switch (targetEntityType) {
    case 'TASK':
      return (await tx.task.findUnique({
        where: { id: targetEntityId },
        include: { sections: true },
      })) as TargetRow | null;
    case 'DESIGN_DOC':
      return (await tx.designDoc.findUnique({
        where: { id: targetEntityId },
        include: { sections: true },
      })) as TargetRow | null;
    default:
      return null;
  }
}

/**
 * Captures the target's content for the paths a proposal changes, keyed the
 * way proposal history keys them (`name`, `sections.<key>.content`), so an
 * eval proposal's diff still renders after the target has moved on. A DELETE
 * changes everything, so it keeps the name and every section.
 */
export async function captureRetainedOriginalTargetContent(
  tx: AnyTransactionClient,
  proposal: {
    action: string;
    targetEntityType: string;
    targetEntityId: string;
    updates: unknown;
  },
): Promise<Record<string, unknown> | null> {
  if (proposal.action !== 'UPDATE' && proposal.action !== 'DELETE') {
    return null;
  }
  const target = await loadTarget(
    tx,
    proposal.targetEntityType,
    proposal.targetEntityId,
  );
  if (!target) {
    return null;
  }

  const retained: Record<string, unknown> = {};
  const sectionContent = (key: string): string | null =>
    target.sections.find((section) => section.key === key)
      ?.materializedMarkdown ?? null;

  if (proposal.action === 'DELETE') {
    retained['name'] = target['name'] ?? null;
    for (const section of target.sections) {
      retained[`sections.${section.key}.content`] =
        section.materializedMarkdown ?? null;
    }
    return retained;
  }

  if (!isRecord(proposal.updates)) {
    return retained;
  }
  for (const [path, value] of Object.entries(proposal.updates)) {
    if (path !== 'sections' || !Array.isArray(value)) {
      retained[path] = path in target ? (target[path] ?? null) : null;
      continue;
    }
    for (const section of value) {
      if (isRecord(section) && typeof section['key'] === 'string') {
        retained[`sections.${section['key']}.content`] = sectionContent(
          section['key'],
        );
      }
    }
  }
  return retained;
}
