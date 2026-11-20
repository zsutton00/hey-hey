import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  EvalAttemptReportPayload,
  EvalRunReportPayload,
} from '@hey-hey/contracts/api/models';
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

/** The session ids a stored eval run or attempt report payload names. */
/** Attempts recorded before `judgeSessionId` existed name their judge only inside the assessment. */
function assessmentJudgeSessionId(
  assessment: object | null | undefined,
): unknown {
  return assessment && 'judgeSessionId' in assessment
    ? assessment.judgeSessionId
    : undefined;
}

function evalSessionIdsOf(
  payload: EvalRunReportPayload | EvalAttemptReportPayload,
): string[] {
  const ids =
    payload.reportType === 'EVAL_RUN'
      ? [payload.coordinatorAgentSessionId]
      : [
          payload.targetSessionId,
          payload.judgeSessionId,
          assessmentJudgeSessionId(payload.automatedAssessment),
        ];

  return ids.filter((id): id is string => typeof id === 'string');
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
      policy.excludedReportTypes.length === 0 &&
      !policy.hidesEvalSessions
    ) {
      return hidden;
    }

    const taskIds = this.idsOfType(refs, 'TASK');
    const reportIds = this.idsOfType(refs, 'REPORT');
    const sessionIds = policy.hidesEvalSessions
      ? this.idsOfType(refs, 'AGENT_SESSION')
      : [];

    const [tasks, reports, evalSessionIds] = await Promise.all([
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
      this.evalSessionIdsAmong(sessionIds),
    ]);

    for (const row of [...tasks, ...reports]) {
      hidden.add(row.id);
    }
    for (const id of evalSessionIds) {
      hidden.add(id);
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

  /**
   * The sessions an eval run recorded: its coordinator, each attempt's target and each judge.
   * They are found through the run's own reports, so sessions carry no marker.
   */
  private async evalSessionIdsAmong(
    sessionIds: readonly string[],
  ): Promise<string[]> {
    if (sessionIds.length === 0) {
      return [];
    }

    const recorded = (path: string[]) =>
      sessionIds.map((id) => ({ payload: { path, equals: id } }));
    const reports = await this.prisma.db.report.findMany({
      where: {
        OR: [
          {
            reportType: 'EVAL_RUN',
            OR: recorded(['coordinatorAgentSessionId']),
          },
          {
            reportType: 'EVAL_ATTEMPT',
            OR: [
              ...recorded(['targetSessionId']),
              ...recorded(['judgeSessionId']),
              ...recorded(['automatedAssessment', 'judgeSessionId']),
            ],
          },
        ],
      },
      select: { payload: true },
    });

    const recordedIds = new Set(
      reports.flatMap(({ payload }) =>
        evalSessionIdsOf(
          payload as unknown as EvalRunReportPayload | EvalAttemptReportPayload,
        ),
      ),
    );

    return sessionIds.filter((id) => recordedIds.has(id));
  }

  private idsOfType(
    refs: readonly EntityRef[],
    type: 'TASK' | 'REPORT' | 'AGENT_SESSION',
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
