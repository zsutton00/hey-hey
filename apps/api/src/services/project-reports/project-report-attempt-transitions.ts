import { Prisma, ProjectReportStatus as DbStatus } from '@prisma/client';
import type { ProjectReportFailure } from 'src/generated';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';

/**
 * Attempt transitions shared by the request service and by the durable
 * operation owners (registry, dispatch) that terminalize a START_RUN. Kept
 * free of Nest dependencies so operation infrastructure can call it inside its
 * own transaction without a DI edge back into project reports.
 */
export async function failProjectReportAttemptInTransaction(
  tx: AnyTransactionClient,
  requestId: string,
  attemptId: string,
  failure: ProjectReportFailure,
  fromStatuses: readonly DbStatus[],
): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM project_report_requests WHERE id = ${requestId} FOR UPDATE`;
  const latest = await tx.projectReportAttempt.findFirst({
    where: { requestId },
    orderBy: { attemptNumber: 'desc' },
    select: { id: true },
  });
  if (latest?.id !== attemptId) return false;
  const result = await tx.projectReportAttempt.updateMany({
    where: {
      id: attemptId,
      requestId,
      status: { in: [...fromStatuses] },
    },
    data: {
      status: DbStatus.FAILED,
      failedAt: new Date(),
      failure: failure as Prisma.InputJsonValue,
    },
  });
  if (result.count !== 1) return false;
  await tx.projectReportRequest.update({
    where: { id: requestId },
    data: { status: DbStatus.FAILED },
  });
  return true;
}

/**
 * A START_RUN that reaches a terminal non-success state can never start the
 * report run it was admitted for, so the bound attempt fails with it. No-op
 * for sessions that are not bound to a project report attempt.
 */
export async function failProjectReportStartRunInTransaction(
  tx: AnyTransactionClient,
  agentSessionId: string,
  outcome: 'DENIED' | 'FAILED',
): Promise<void> {
  const attempt = await tx.projectReportAttempt.findUnique({
    where: { agentSessionId },
    select: { id: true, requestId: true },
  });
  if (!attempt) return;
  await failProjectReportAttemptInTransaction(
    tx,
    attempt.requestId,
    attempt.id,
    outcome === 'DENIED'
      ? {
          stage: 'LAUNCH',
          code: 'START_RUN_REJECTED',
          message: 'The selected machine rejected the report run',
          retryable: true,
        }
      : {
          stage: 'LAUNCH',
          code: 'START_RUN_FAILED',
          message: 'The project report run could not start',
          retryable: true,
        },
    [DbStatus.QUEUED, DbStatus.RUNNING],
  );
}
