import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ReportType as PrismaReportType } from '@prisma/client';
import { EvalAttemptStatus } from 'src/generated';
import { EventContextManager } from 'src/core/events/observable-event.context';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { captureRetainedOriginalTargetContent } from '../proposal/proposal-original-content';

export type EvalOutputStamp = {
  ragEnabled: boolean;
  applicationEligible: boolean;
};

export type EvalOutputAdmission = EvalOutputStamp & { isEvalOutput: boolean };

export const ORDINARY_EVAL_OUTPUT_STAMP: EvalOutputAdmission = {
  ragEnabled: true,
  applicationEligible: true,
  isEvalOutput: false,
};

const EVAL_OUTPUT_STAMP: EvalOutputAdmission = {
  ragEnabled: false,
  applicationEligible: false,
  isEvalOutput: true,
};

const IN_FLIGHT_ATTEMPT_STATUSES: EvalAttemptStatus[] = [
  EvalAttemptStatus.Preparing,
  EvalAttemptStatus.Running,
  EvalAttemptStatus.Judging,
];

/**
 * The agent session the current request writes under, taken from the
 * X-Agent-Session-ID header the HTTP boundary records on the event context.
 */
export function currentWritingSessionId(): string | null {
  return (
    EventContextManager.getInstance().getCurrentContext()?.agentSessionId ??
    null
  );
}

@Injectable()
export class EvalOutputAdmissionService {
  private readonly logger = new Logger(EvalOutputAdmissionService.name);

  /**
   * Output written by the target session of an in-flight eval attempt in the
   * same project is eval output: retained, but excluded from project knowledge
   * and never applicable. Any other writer is stored as an ordinary write.
   */
  async resolve(
    tx: AnyTransactionClient,
    params: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      writingSessionId?: string | null;
    },
  ): Promise<EvalOutputAdmission> {
    if (!params.writingSessionId) {
      return ORDINARY_EVAL_OUTPUT_STAMP;
    }
    const attempt = await tx.report.findFirst({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        reportType: PrismaReportType.EVAL_ATTEMPT,
        AND: [
          {
            payload: {
              path: ['targetSessionId'],
              equals: params.writingSessionId,
            },
          },
          {
            OR: IN_FLIGHT_ATTEMPT_STATUSES.map((status) => ({
              payload: { path: ['status'], equals: status },
            })),
          },
        ],
      },
      select: { id: true },
    });
    if (!attempt) {
      return ORDINARY_EVAL_OUTPUT_STAMP;
    }
    this.logger.log('Admitting eval target output as inert', {
      evalAttemptReportId: attempt.id,
      writingSessionId: params.writingSessionId,
    });
    return EVAL_OUTPUT_STAMP;
  }

  /**
   * Admits a proposal written by an eval target. Besides the stamp, it
   * returns the proposal columns that keep the proposal readable but inert:
   * out of ingestion and application, with the target's original content
   * captured now so the diff survives later edits to the target.
   */
  async resolveProposal(
    tx: AnyTransactionClient,
    params: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      writingSessionId?: string | null;
      proposal: {
        action: string;
        targetEntityType: string;
        targetEntityId: string;
        updates: unknown;
      };
    },
  ): Promise<{
    stamp: EvalOutputAdmission;
    data: Partial<Prisma.ProposalUncheckedCreateInput>;
  }> {
    const stamp = await this.resolve(tx, params);
    if (!stamp.isEvalOutput) {
      return { stamp, data: {} };
    }
    const retained = await captureRetainedOriginalTargetContent(
      tx,
      params.proposal,
    );
    return {
      stamp,
      data: {
        ragEnabled: stamp.ragEnabled,
        applicationEligible: stamp.applicationEligible,
        retainedOriginalTargetContent: retained
          ? (retained as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    };
  }
}
