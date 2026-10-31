import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReadPolicyContext } from './read-policy';

export interface ProposalRef {
  readonly targetEntityId: string;
  readonly targetEntityType: string;
  readonly updates: unknown;
}

function hasStringType(updates: unknown): updates is { type: string } {
  return (
    typeof updates === 'object' &&
    updates !== null &&
    'type' in updates &&
    typeof updates.type === 'string'
  );
}

/** The work-item type a proposal's content declares, when it declares one. */
function proposedWorkItemType(updates: unknown): string | undefined {
  return hasStringType(updates) ? updates.type : undefined;
}

export interface EntityRef {
  readonly entityType: string;
  readonly entityId: string;
}

/**
 * Answers which entities the current request must not see. Aggregate read paths (related items,
 * edges, hierarchies, recents, proposal history) call it so a protected record is absent from
 * the result as well as from direct reads. An unrestricted request never touches the database.
 */
@Injectable()
export class ReadVisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async hiddenIds(refs: readonly EntityRef[]): Promise<ReadonlySet<string>> {
    const policy = ReadPolicyContext.current();
    const hidden = new Set<string>();

    if (
      policy.excludedTaskTypes.length === 0 &&
      policy.excludedReportTypes.length === 0
    ) {
      return hidden;
    }

    const taskIds = this.idsOfType(refs, 'TASK');
    const reportIds = this.idsOfType(refs, 'REPORT');

    const [tasks, reports] = await Promise.all([
      taskIds.length > 0 && policy.excludedTaskTypes.length > 0
        ? this.prisma.db.task.findMany({
            where: {
              id: { in: taskIds },
              type: { in: [...policy.excludedTaskTypes] },
            },
            select: { id: true },
          })
        : [],
      reportIds.length > 0 && policy.excludedReportTypes.length > 0
        ? this.prisma.db.report.findMany({
            where: {
              id: { in: reportIds },
              reportType: { in: [...policy.excludedReportTypes] },
            },
            select: { id: true },
          })
        : [],
    ]);

    for (const row of [...tasks, ...reports]) {
      hidden.add(row.id);
    }

    return hidden;
  }

  async filterVisible<T>(
    items: readonly T[],
    refOf: (item: T) => EntityRef | undefined,
  ): Promise<T[]> {
    const refs = items.flatMap((item) => refOf(item) ?? []);
    const hidden = await this.hiddenIds(refs);

    if (hidden.size === 0) {
      return [...items];
    }

    return items.filter((item) => {
      const ref = refOf(item);

      return ref === undefined || !hidden.has(ref.entityId);
    });
  }

  /**
   * A proposal is protected when it targets a protected record or, for a creation not yet
   * applied, carries a protected work-item type in its content.
   */
  async filterVisibleProposals<T extends ProposalRef>(
    proposals: readonly T[],
  ): Promise<T[]> {
    const { excludedTaskTypes } = ReadPolicyContext.current();
    const hidden = await this.hiddenIds(
      proposals.map((proposal) => ({
        entityType: proposal.targetEntityType,
        entityId: proposal.targetEntityId,
      })),
    );

    return proposals.filter((proposal) => {
      const proposedType = proposedWorkItemType(proposal.updates);

      return (
        !hidden.has(proposal.targetEntityId) &&
        !(
          proposedType !== undefined && excludedTaskTypes.includes(proposedType)
        )
      );
    });
  }

  /** Direct reads of a protected record get the same answer as a record that does not exist. */
  async assertVisible(entityType: string, entityId: string): Promise<void> {
    const hidden = await this.hiddenIds([{ entityType, entityId }]);

    if (hidden.has(entityId)) {
      throw new NotFoundException(
        `${entityType} with id ${entityId} not found`,
      );
    }
  }

  private idsOfType(
    refs: readonly EntityRef[],
    type: 'TASK' | 'REPORT',
  ): string[] {
    return [
      ...new Set(
        refs
          .filter((ref) => ref.entityType === type)
          .map((ref) => ref.entityId),
      ),
    ];
  }
}
