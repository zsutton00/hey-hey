import { queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  ReportAudience,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportSortBy,
  ReportSortOrder,
  ReportType,
  type EvalAttemptReportPayload,
  type EvalAttemptUpdatedEvent,
  type EvalHumanReviewReportPayload,
  type EvalRecordedAttempt,
  type EvalRunReportPayload,
  type EvalRunUpdatedEvent,
  type LaunchEvalRunRequest,
  type MessageResponseDto,
  type ProposalResponseDto,
  type ReportDto,
  type RunCreatePayloadRunEval,
} from "../../api";
import {
  evalRunsClient,
  platformClient,
  unifiedApiClient,
} from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import { messageKeys } from "./messages";
import { reportKeys } from "./reports";

/** The largest page the report list read serves; it has no offset. */
export const EVAL_REPORT_READ_LIMIT = 200;

export type EvalRunReport = ReportDto & {
  payload: EvalRunReportPayload & { reportType: "EVAL_RUN" };
};
export type EvalAttemptReport = ReportDto & {
  payload: EvalAttemptReportPayload & { reportType: "EVAL_ATTEMPT" };
};
export type EvalHumanReviewReport = ReportDto & {
  payload: EvalHumanReviewReportPayload & { reportType: "EVAL_HUMAN_REVIEW" };
};

export const isEvalRunReport = (report: ReportDto): report is EvalRunReport =>
  report.payload.reportType === ReportType.EvalRun;
export const isEvalAttemptReport = (
  report: ReportDto,
): report is EvalAttemptReport =>
  report.payload.reportType === ReportType.EvalAttempt;
export const isEvalHumanReviewReport = (
  report: ReportDto,
): report is EvalHumanReviewReport =>
  report.payload.reportType === ReportType.EvalHumanReview;

// Nested under the reports root so every report invalidation covers them.
export const evalRunKeys = {
  all: (org: string) => [...reportKeys.all(org), "eval"] as const,
  runs: (org: string, project: string, evalId: string) =>
    [...evalRunKeys.all(org), "runs", project, evalId] as const,
  run: (org: string, runId: string) =>
    [...evalRunKeys.all(org), "run", runId] as const,
  attempts: (org: string, runId: string) =>
    [...evalRunKeys.all(org), "attempts", runId] as const,
  reviews: (org: string, attemptId: string) =>
    [...evalRunKeys.all(org), "reviews", attemptId] as const,
};

const narrow = <T extends ReportDto>(
  reports: ReportDto[],
  guard: (report: ReportDto) => report is T,
): T[] => reports.filter(guard);

export function evalRunsQueryOptions(
  organizationId: string,
  projectId: string,
  evalId: string,
) {
  const requestOptions = captureRequestOptions();
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: evalRunKeys.runs(organizationId, projectId, evalId),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.listReports(
        {
          organizationId,
          projectId,
          reportType: ReportType.EvalRun,
          entityType: ReportRelatedEntityType.Task,
          entityId: evalId,
          relation: ReportEntityRelation.Primary,
          limit: EVAL_REPORT_READ_LIMIT,
        },
        { ...requestOptions, signal },
      );
      return narrow(response.data.data ?? [], isEvalRunReport);
    },
  });
}

export function evalRunQueryOptions(organizationId: string, runId: string) {
  const requestOptions = captureRequestOptions();
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: evalRunKeys.run(organizationId, runId),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.getReport(
        { organizationId, reportId: runId },
        { ...requestOptions, signal },
      );
      const report = response.data.data;
      if (!report) return null;
      if (!isEvalRunReport(report)) {
        throw new Error(`Report ${runId} is not an eval run`);
      }
      return report;
    },
  });
}

export interface EvalAttemptOutput {
  messages: MessageResponseDto[];
  proposals: ProposalResponseDto[];
  reports: ReportDto[];
}

export const toEvalAttemptOutput = (
  messages: MessageResponseDto[],
): EvalAttemptOutput => ({
  messages,
  proposals: messages.flatMap((message) => message.proposals ?? []),
  reports: messages.flatMap((message) => message.reports ?? []),
});

/**
 * An attempt's output is its target conversation: the full thread with the
 * proposals and reports made from its messages. Keyed under the conversation's
 * message reads so their invalidations refresh it, and cached as messages like
 * every other read under that prefix.
 */
export const evalAttemptOutputKey = (
  organizationId: string,
  projectId: string,
  targetConversationId: string,
) =>
  [
    ...messageKeys.conversation(
      organizationId,
      projectId,
      targetConversationId,
    ),
    "evalAttemptOutput",
  ] as const;

export function evalAttemptOutputQueryOptions(
  organizationId: string,
  projectId: string,
  targetConversationId: string,
) {
  const requestOptions = captureRequestOptions();
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: evalAttemptOutputKey(
      organizationId,
      projectId,
      targetConversationId,
    ),
    queryFn: async ({ signal }): Promise<MessageResponseDto[]> => {
      // No cursor, mode or limit: the forward read returns the whole thread.
      const response = await platformClient.getMessages(
        {
          organizationId,
          projectId,
          conversationId: targetConversationId,
          includeProposals: true,
          includeReports: true,
        },
        { ...requestOptions, signal },
      );
      const data = response.data?.data;
      if (data !== undefined && !Array.isArray(data)) {
        throw new Error(
          "Attempt conversation read returned an invalid response",
        );
      }
      return data ?? [];
    },
  });
}

/** Number of attempts launch recorded: one per case and configuration. */
export const expectedAttemptCount = (run: EvalRunReport): number =>
  run.payload.cases.length * run.payload.configurations.length;

export function evalAttemptsQueryOptions(
  organizationId: string,
  runId: string,
) {
  const requestOptions = captureRequestOptions();
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: evalRunKeys.attempts(organizationId, runId),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.listReports(
        {
          organizationId,
          parentReportId: runId,
          reportType: ReportType.EvalAttempt,
          limit: EVAL_REPORT_READ_LIMIT,
          sortBy: ReportSortBy.CreatedAt,
          sortOrder: ReportSortOrder.Asc,
        },
        { ...requestOptions, signal },
      );
      const attempts = narrow(response.data.data ?? [], isEvalAttemptReport);
      if (attempts.length >= EVAL_REPORT_READ_LIMIT) {
        throw new Error(
          `Eval run ${runId} has more attempts than one report read returns (${EVAL_REPORT_READ_LIMIT})`,
        );
      }
      return attempts;
    },
  });
}

export function evalHumanReviewsQueryOptions(
  organizationId: string,
  attemptId: string,
) {
  const requestOptions = captureRequestOptions();
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: evalRunKeys.reviews(organizationId, attemptId),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.listReports(
        {
          organizationId,
          parentReportId: attemptId,
          reportType: ReportType.EvalHumanReview,
          limit: EVAL_REPORT_READ_LIMIT,
        },
        { ...requestOptions, signal },
      );
      return narrow(response.data.data ?? [], isEvalHumanReviewReport);
    },
  });
}

export async function launchEvalRun(
  organizationId: string,
  projectId: string,
  evalId: string,
  request: LaunchEvalRunRequest,
): Promise<EvalRunReport> {
  const response = await evalRunsClient.launchEvalRun({
    organizationId,
    projectId,
    evalId,
    launchEvalRunRequest: request,
  });
  const report = response.data.data;
  if (!report || !isEvalRunReport(report)) {
    throw new Error("Launching the eval run returned no run report");
  }
  return report;
}

export interface SaveEvalHumanReviewInput {
  projectId: string;
  evalId: string;
  attemptId: string;
  score: number;
  comment?: string | null;
  challengeCase: boolean;
  summary: string;
}

/**
 * A person's review is its own child report of the attempt and never edits
 * the automated assessment. It is anchored to the Eval so it goes with it.
 */
export async function saveEvalHumanReview(
  organizationId: string,
  input: SaveEvalHumanReviewInput,
): Promise<EvalHumanReviewReport> {
  const response = await unifiedApiClient.createReport({
    organizationId,
    createReportDto: {
      projectId: input.projectId,
      audience: ReportAudience.ProjectVisible,
      neverExpires: true,
      parentReportId: input.attemptId,
      reportType: ReportType.EvalHumanReview,
      entities: [
        {
          entityType: ReportRelatedEntityType.Task,
          entityId: input.evalId,
          relation: ReportEntityRelation.Primary,
        },
      ],
      payload: {
        summary: input.summary,
        reportType: ReportType.EvalHumanReview,
        score: input.score,
        comment: input.comment ?? null,
        challengeCase: input.challengeCase,
      },
    },
  });
  const report = response.data.data;
  if (!report || !isEvalHumanReviewReport(report)) {
    throw new Error("Saving the review returned no review report");
  }
  return report;
}

/**
 * The run_eval start payload, built only from what launch recorded so the
 * API's exact-match check against the recorded run always passes.
 */
export function buildRunEvalStartPayload(
  run: EvalRunReport,
  attempts: EvalAttemptReport[],
  userMessage: string,
): RunCreatePayloadRunEval {
  if (attempts.length !== expectedAttemptCount(run)) {
    throw new Error(
      `Eval run ${run.id} recorded ${expectedAttemptCount(run)} attempts but ${attempts.length} were read`,
    );
  }
  const cases = new Map(run.payload.cases.map((c) => [c.id, c]));
  const recordedAttempts: EvalRecordedAttempt[] = attempts.map((attempt) => {
    const caseInput = cases.get(attempt.payload.caseInputId);
    if (!caseInput) {
      throw new Error(
        `Attempt ${attempt.id} names case ${attempt.payload.caseInputId}, which run ${run.id} did not record`,
      );
    }
    const { targetSessionId, targetConversationId, execution } =
      attempt.payload;
    if (!targetSessionId || !targetConversationId) {
      throw new Error(
        `Attempt ${attempt.id} is missing its recorded target session or conversation`,
      );
    }
    if (!execution) {
      throw new Error(
        `Attempt ${attempt.id} did not record what it executes, so it cannot be started`,
      );
    }
    return {
      attemptId: attempt.id,
      execution,
      targetSessionId,
      targetConversationId,
      caseInput,
      configuration: attempt.payload.configuration,
    };
  });
  return {
    promptType: "run_eval",
    entity: { entityType: "TASK", entityId: run.payload.evalId },
    userMessage,
    evalRunId: run.id,
    judgeSetup: run.payload.judgeSetup,
    settings: run.payload.settings,
    attempts: recordedAttempts,
  };
}

export function storeEvalRun(
  queryClient: QueryClient,
  organizationId: string,
  run: EvalRunReport,
): void {
  queryClient.setQueryData(evalRunKeys.run(organizationId, run.id), run);
}

/** Applies a run's own progress event and refreshes the Eval's run list. */
export function applyEvalRunUpdated(
  queryClient: QueryClient,
  event: EvalRunUpdatedEvent,
): Promise<void> {
  const { organizationId, projectId, evalId, run } = event.payload;
  if (isEvalRunReport(run)) storeEvalRun(queryClient, organizationId, run);
  return invalidateWithFollowUpRead(queryClient, {
    queryKey: evalRunKeys.runs(organizationId, projectId, evalId),
    exact: true,
  });
}

/** Replaces the changed attempt inside the open run's attempt list. */
export function applyEvalAttemptUpdated(
  queryClient: QueryClient,
  event: EvalAttemptUpdatedEvent,
): Promise<void> {
  const { organizationId, evalRunId, attempt } = event.payload;
  const key = evalRunKeys.attempts(organizationId, evalRunId);
  const current = queryClient.getQueryData<EvalAttemptReport[]>(key);
  if (current && isEvalAttemptReport(attempt)) {
    const known = current.some(({ id }) => id === attempt.id);
    if (known) {
      queryClient.setQueryData<EvalAttemptReport[]>(
        key,
        current.map((existing) =>
          existing.id === attempt.id ? attempt : existing,
        ),
      );
      return Promise.resolve();
    }
  }
  return invalidateWithFollowUpRead(queryClient, {
    queryKey: key,
    exact: true,
  });
}
