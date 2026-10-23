import { NotFoundException } from '@nestjs/common';
import {
  DesignDocParentEntityType,
  type DesignDocSection,
} from '@prisma/client';
import { AnyTransactionClient } from '../../prisma/prisma.service';
import { OrganizationId, ProjectId } from '../../types';
import { PlanDesignDocLinksService } from '../design-doc/plan-design-doc-links.service';

/** Resolve the generation seed from canonical work-item relationships. */
export async function resolvePlanGenerationDesignDoc(
  tx: AnyTransactionClient,
  organizationId: OrganizationId,
  projectId: ProjectId,
  planId: string,
  links: PlanDesignDocLinksService,
): Promise<{
  id: string;
  sections: Pick<DesignDocSection, 'materializedMarkdown'>[];
}> {
  const selection = {
    id: true,
    sections: {
      orderBy: { order: 'asc' as const },
      select: { materializedMarkdown: true },
    },
  } as const;
  const graphIds = await links.resolve(organizationId, projectId, planId);
  if (graphIds.length) {
    const seed = await tx.designDoc.findFirst({
      where: {
        id: { in: graphIds },
        organizationId,
        projectId,
        archivedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: selection,
    });
    if (!seed)
      throw new NotFoundException(
        'Plan seed design document is missing or archived',
      );
    return seed;
  }
  const document = await tx.designDoc.findFirst({
    where: {
      organizationId,
      projectId,
      archivedAt: null,
      parentEntityType: DesignDocParentEntityType.TASK,
      parentEntityId: planId,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: selection,
  });
  if (document) return document;

  throw new NotFoundException(
    'Plan has no linked design document to generate from',
  );
}
