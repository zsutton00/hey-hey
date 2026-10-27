import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LaunchEvalRunRequest } from "../../api";
import {
  readRetainedResearch,
  type RetainedResearch,
} from "../collections/evalRetainedResearch";
import {
  evalAttemptOutputQueryOptions,
  evalAttemptsQueryOptions,
  evalHumanReviewsQueryOptions,
  evalRunKeys,
  evalRunQueryOptions,
  evalRunsQueryOptions,
  launchEvalRun,
  saveEvalHumanReview,
  storeEvalRun,
  toEvalAttemptOutput,
  type EvalAttemptOutput,
  type EvalAttemptReport,
  type EvalHumanReviewReport,
  type EvalRunReport,
  type SaveEvalHumanReviewInput,
} from "../collections/evalRuns";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
  DataHookReturn,
} from "../core/types";
import type { MutationOptions } from "../core/useMutation";
import { useMutation } from "../core/useMutation";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

const NOOP = "__noop__";
const NO_RUNS: EvalRunReport[] = [];
const NO_ATTEMPTS: EvalAttemptReport[] = [];
const NO_REVIEWS: EvalHumanReviewReport[] = [];

/** Runs recorded on one Eval, newest first. */
export function useEvalRuns(
  organizationId: string | undefined,
  projectId: string | undefined,
  evalId: string | undefined,
  options: CollectionHookOptions<EvalRunReport> = {},
): DataCollectionHookReturn<EvalRunReport> & { runs: EvalRunReport[] } {
  const queryOptions = useMemo(
    () =>
      evalRunsQueryOptions(
        organizationId ?? NOOP,
        projectId ?? NOOP,
        evalId ?? NOOP,
      ),
    [organizationId, projectId, evalId],
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    ...options,
    enabled:
      (options.enabled ?? true) && !!organizationId && !!projectId && !!evalId,
  });
  const data = result.data ?? NO_RUNS;
  const runs = useMemo(
    () => [...data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data],
  );
  return { ...state, runs, data: runs };
}

export interface UseEvalRunReturn extends DataHookReturn<EvalRunReport> {
  attempts: EvalAttemptReport[];
}

/** One run with its attempts; both stay live through progress events. */
export function useEvalRun(
  organizationId: string | undefined,
  runId: string | undefined,
  options: CollectionHookOptions<EvalRunReport> = {},
): UseEvalRunReturn {
  const enabled = (options.enabled ?? true) && !!organizationId && !!runId;
  const runOptions = useMemo(
    () => evalRunQueryOptions(organizationId ?? NOOP, runId ?? NOOP),
    [organizationId, runId],
  );
  const attemptOptions = useMemo(
    () => evalAttemptsQueryOptions(organizationId ?? NOOP, runId ?? NOOP),
    [organizationId, runId],
  );
  const run = useDataLayerQuery(runOptions, { ...options, enabled });
  const attempts = useDataLayerQuery(attemptOptions, { enabled });
  return {
    ...run.state,
    isLoading: run.state.isLoading || attempts.state.isLoading,
    isFetching: run.state.isFetching || attempts.state.isFetching,
    isFetched: run.state.isFetched && attempts.state.isFetched,
    isReady: run.state.isReady && attempts.state.isReady,
    error: run.state.error ?? attempts.state.error,
    data: run.result.data ?? null,
    attempts: attempts.result.data ?? NO_ATTEMPTS,
  };
}

/** People's reviews of one attempt. */
export function useEvalHumanReviews(
  organizationId: string | undefined,
  attemptId: string | undefined,
  options: CollectionHookOptions<EvalHumanReviewReport> = {},
): DataCollectionHookReturn<EvalHumanReviewReport> {
  const queryOptions = useMemo(
    () =>
      evalHumanReviewsQueryOptions(organizationId ?? NOOP, attemptId ?? NOOP),
    [organizationId, attemptId],
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    ...options,
    enabled: (options.enabled ?? true) && !!organizationId && !!attemptId,
  });
  return { ...state, data: result.data ?? NO_REVIEWS };
}

export interface UseEvalAttemptOutputReturn extends DataHookReturn<EvalAttemptOutput> {
  /**
   * False when the attempt records no target conversation (runs launched
   * before attempts had their own sessions): there is no output to read.
   */
  hasRecordedConversation: boolean;
  /**
   * The research the attempt's own record kept. Independent of the
   * conversation: attempts run before messages were saved hold their research
   * here while the conversation has no report attached.
   */
  retainedResearch: RetainedResearch;
}

/**
 * Everything one attempt produced: its target conversation's messages and the
 * proposals and reports made from them. Proposals carry their retained
 * original content, so their diffs do not depend on the current target.
 */
export function useEvalAttemptOutput(
  organizationId: string | undefined,
  attempt: EvalAttemptReport | null | undefined,
  options: CollectionHookOptions<EvalAttemptOutput> = {},
): UseEvalAttemptOutputReturn {
  const projectId = attempt?.projectId;
  const conversationId = attempt?.payload.targetConversationId ?? undefined;
  const queryOptions = useMemo(
    () => ({
      ...evalAttemptOutputQueryOptions(
        organizationId ?? NOOP,
        projectId ?? NOOP,
        conversationId ?? NOOP,
      ),
      select: toEvalAttemptOutput,
    }),
    [organizationId, projectId, conversationId],
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    ...options,
    enabled:
      (options.enabled ?? true) &&
      !!organizationId &&
      !!projectId &&
      !!conversationId,
  });
  const summary: unknown = attempt?.payload.summary;
  const retainedResearch = useMemo(
    () => readRetainedResearch(summary),
    [summary],
  );
  return {
    ...state,
    data: result.data ?? null,
    hasRecordedConversation: !!conversationId,
    retainedResearch,
  };
}

export interface LaunchEvalRunVariables {
  organizationId: string;
  projectId: string;
  evalId: string;
  request: LaunchEvalRunRequest;
}

/**
 * Records the run and its attempts. No agent starts until the caller starts
 * the run's prepared session with buildRunEvalStartPayload.
 */
export function useLaunchEvalRun(options: MutationOptions<EvalRunReport> = {}) {
  const queryClient = useQueryClient();
  return useMutation(
    async ({
      organizationId,
      projectId,
      evalId,
      request,
    }: LaunchEvalRunVariables): Promise<EvalRunReport> => {
      const run = await launchEvalRun(
        organizationId,
        projectId,
        evalId,
        request,
      );
      storeEvalRun(queryClient, organizationId, run);
      await invalidateWithFollowUpRead(queryClient, {
        queryKey: evalRunKeys.runs(organizationId, projectId, evalId),
        exact: true,
      });
      return run;
    },
    options,
  );
}

export interface SaveEvalHumanReviewVariables extends SaveEvalHumanReviewInput {
  organizationId: string;
}

export function useSaveEvalHumanReview(
  options: MutationOptions<EvalHumanReviewReport> = {},
) {
  const queryClient = useQueryClient();
  return useMutation(
    async ({
      organizationId,
      ...input
    }: SaveEvalHumanReviewVariables): Promise<EvalHumanReviewReport> => {
      const review = await saveEvalHumanReview(organizationId, input);
      await invalidateWithFollowUpRead(queryClient, {
        queryKey: evalRunKeys.reviews(organizationId, input.attemptId),
        exact: true,
      });
      return review;
    },
    options,
  );
}
