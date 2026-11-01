/**
 * Host-authored coverage and evidence-read provenance for PROJECT_REPORT
 * submissions.
 *
 * The evidence reader computes coverage in code during `prepare`. The handler
 * persists that result on the Run's `sessionContext` (Run-scoped: one
 * AgentSession is one request attempt), and the `create_report` wrapper stamps
 * it onto the submitted payload. The model may only lower coverage: mark it
 * INCOMPLETE, lower processedActivityCount, or add limitations.
 *
 * Coverage is only true if every evidence shard was read. The host, not the
 * agent, establishes that: `assertProjectReportEvidenceRead` refuses a
 * submission until the ledger shows the host served every page of every shard.
 */

import { z } from 'zod';
import {
  ProjectReportCoverageStatusEnum,
  type ProjectReportCoverage,
} from '../../shared/api/generated/api';
import {
  SubmissionToolCorrectableError,
  type SubmissionToolCorrectableFinding,
} from '../submission-tools/types';
import type { ProjectReportEvidenceResult } from './project-report-evidence-reader';
import type { ProjectReportEvidenceLedger } from './project-report-evidence-store';

const PROJECT_REPORT_PREPARED_EVIDENCE_KEY = 'projectReport.preparedEvidence';

const coverageStatusSchema = z.enum([
  ProjectReportCoverageStatusEnum.Complete,
  ProjectReportCoverageStatusEnum.Incomplete,
]);

const preparedEvidenceSchema = z
  .object({
    requestId: z.string().min(1),
    attemptId: z.string().min(1),
    evidenceReadStartedAt: z.string().min(1),
    evidenceReadCompletedAt: z.string().min(1),
    coverage: z
      .object({
        status: coverageStatusSchema,
        matchingActivityCount: z.number().int().nonnegative(),
        processedActivityCount: z.number().int().nonnegative(),
        pagesRead: z.number().int().nonnegative(),
        limitations: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

export type ProjectReportPreparedEvidence = z.infer<typeof preparedEvidenceSchema>;

const submittedCoverageSchema = z.object({
  status: coverageStatusSchema,
  processedActivityCount: z.number().int().nonnegative(),
  limitations: z.array(z.string()),
});

export const serializeProjectReportPreparedEvidence = (input: {
  requestId: string;
  attemptId: string;
  evidence: ProjectReportEvidenceResult;
}): Record<string, unknown> => ({
  [PROJECT_REPORT_PREPARED_EVIDENCE_KEY]: {
    requestId: input.requestId,
    attemptId: input.attemptId,
    evidenceReadStartedAt: input.evidence.evidenceReadStartedAt,
    evidenceReadCompletedAt: input.evidence.evidenceReadCompletedAt,
    coverage: input.evidence.coverage,
  } satisfies ProjectReportPreparedEvidence,
});

export const parseProjectReportPreparedEvidence = (
  sessionContext: Readonly<Record<string, unknown>> | undefined,
): ProjectReportPreparedEvidence => {
  const parsed = preparedEvidenceSchema.safeParse(
    sessionContext?.[PROJECT_REPORT_PREPARED_EVIDENCE_KEY],
  );
  if (!parsed.success) {
    throw new Error(
      `project_report has no valid prepared evidence on this AgentSession: ${parsed.error.message}`,
    );
  }
  return parsed.data;
};

export type ProjectReportCoverageStampResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Returns the payload with host coverage and evidence-read timestamps stamped
 * on, or an actionable error when the submitted coverage claims more than the
 * host prepared.
 */
export const stampProjectReportCoverage = (
  payload: Record<string, unknown>,
  provenance: Record<string, unknown>,
  prepared: ProjectReportPreparedEvidence,
): ProjectReportCoverageStampResult => {
  const computed = prepared.coverage;
  const submitted = submittedCoverageSchema.safeParse(payload['coverage']);
  if (!submitted.success) {
    return {
      ok: false,
      error: `payload.coverage must contain status, processedActivityCount, and limitations: ${submitted.error.message}`,
    };
  }

  const { status, processedActivityCount, limitations } = submitted.data;
  const problems: string[] = [];
  if (
    computed.status === ProjectReportCoverageStatusEnum.Incomplete &&
    status === ProjectReportCoverageStatusEnum.Complete
  ) {
    problems.push('status must remain INCOMPLETE');
  }
  if (processedActivityCount > computed.processedActivityCount) {
    problems.push(
      `processedActivityCount must not exceed the prepared ${String(computed.processedActivityCount)}`,
    );
  }
  const missingLimitations = computed.limitations.filter(
    (limitation) => !limitations.includes(limitation),
  );
  if (missingLimitations.length > 0) {
    problems.push(
      `limitations must keep every prepared limitation: ${JSON.stringify(missingLimitations)}`,
    );
  }
  const processedLowered = processedActivityCount < computed.processedActivityCount;
  if (processedLowered && status === ProjectReportCoverageStatusEnum.Complete) {
    problems.push('status must be INCOMPLETE when processedActivityCount is lowered');
  }
  const lowered =
    processedLowered ||
    (computed.status === ProjectReportCoverageStatusEnum.Complete &&
      status === ProjectReportCoverageStatusEnum.Incomplete);
  const addedLimitations = limitations.filter(
    (limitation) => !computed.limitations.includes(limitation),
  );
  if (lowered && addedLimitations.length === 0) {
    problems.push('lowering coverage requires an added limitation explaining the gap');
  }
  if (problems.length > 0) {
    return {
      ok: false,
      error: `PROJECT_REPORT coverage may only be lowered from the prepared coverage ${JSON.stringify(computed)}: ${problems.join('; ')}. Fix payload.coverage and make the body describe any incomplete coverage, then resubmit.`,
    };
  }

  const coverage: ProjectReportCoverage = {
    status,
    matchingActivityCount: computed.matchingActivityCount,
    processedActivityCount,
    pagesRead: computed.pagesRead,
    limitations,
  };
  return {
    ok: true,
    payload: {
      ...payload,
      provenance: {
        ...provenance,
        evidenceReadStartedAt: prepared.evidenceReadStartedAt,
        evidenceReadCompletedAt: prepared.evidenceReadCompletedAt,
      },
      coverage,
    },
  };
};

const MAX_UNREAD_SHARDS_LISTED = 50;

/**
 * Refuses a submission while any shard is unread. The refusal is correctable:
 * the agent reads what is listed and submits again, and no write is claimed.
 */
export const assertProjectReportEvidenceRead = (
  ledger: ProjectReportEvidenceLedger | undefined,
): void => {
  if (!ledger) {
    throw new SubmissionToolCorrectableError({
      reason:
        'The host has no record of this report’s evidence being read, so coverage cannot be established.',
      findings: [
        {
          identity: 'evidence',
          reason: 'No evidence ledger exists for this session.',
          correction:
            'The report cannot be submitted from this session. Stop and tell the user the evidence could not be verified.',
        },
      ],
    });
  }

  const unread = ledger.unreadShards();
  if (unread.length === 0) {
    return;
  }

  const findings: SubmissionToolCorrectableFinding[] = unread
    .slice(0, MAX_UNREAD_SHARDS_LISTED)
    .map((shard) => ({
      identity: shard.id,
      reason: `Pages ${ledger.unreadPages(shard).join(', ')} of ${String(shard.pageCount)} have not been read (${shard.groupTitle}).`,
      correction: `Call read_evidence_shard with shardId "${shard.id}" for each unread page, then submit again.`,
    }));
  const omitted = unread.length - findings.length;

  throw new SubmissionToolCorrectableError({
    reason: `${String(unread.length)} of ${String(ledger.manifest.shards.length)} evidence shards have not been read to their last page${omitted > 0 ? `; ${String(omitted)} more than the ${String(findings.length)} listed` : ''}. A report cannot be submitted with unread evidence.`,
    findings,
  });
};
