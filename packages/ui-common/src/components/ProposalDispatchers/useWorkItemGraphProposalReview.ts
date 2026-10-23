import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ProjectedWorkItemChangeSetResponse,
  WorkItemChangeSetOperation,
  WorkItemChangeSetValidationRequest,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import {
  hydrateValidatedWorkItemGraphProjection,
  type WorkItemGraphDraftProjection,
} from "../shared/workItemGraphDraft";

type WorkItemGraphReviewState =
  | { kind: "validating" }
  | { kind: "ready"; projection: WorkItemGraphDraftProjection }
  | {
      kind: "invalid";
      issues: ProjectedWorkItemChangeSetResponse["issues"];
    }
  | { kind: "failed"; message: string };

type WorkItemGraphReviewAction =
  | { type: "validationStarted" }
  | {
      type: "validationSucceeded";
      response: ProjectedWorkItemChangeSetResponse;
      operations: readonly WorkItemChangeSetOperation[];
    }
  | { type: "validationFailed"; error: unknown };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function workItemGraphReviewReducer(
  _state: WorkItemGraphReviewState,
  action: WorkItemGraphReviewAction,
): WorkItemGraphReviewState {
  switch (action.type) {
    case "validationStarted":
      return { kind: "validating" };
    case "validationFailed":
      return {
        kind: "failed",
        message: errorMessage(action.error, "Graph validation failed."),
      };
    case "validationSucceeded":
      if (!action.response.valid) {
        return { kind: "invalid", issues: action.response.issues };
      }
      try {
        return {
          kind: "ready",
          projection: hydrateValidatedWorkItemGraphProjection(
            action.response,
            action.operations,
          ),
        };
      } catch (error) {
        return {
          kind: "failed",
          message: errorMessage(
            error,
            "The projected graph could not be prepared for review.",
          ),
        };
      }
  }
}

function isProjection(
  value: unknown,
): value is ProjectedWorkItemChangeSetResponse {
  if (typeof value !== "object" || value === null) return false;
  return (
    "valid" in value &&
    typeof value.valid === "boolean" &&
    "projectedRoot" in value &&
    "children" in value &&
    Array.isArray(value.children) &&
    "incidentRelationships" in value &&
    Array.isArray(value.incidentRelationships) &&
    "issues" in value &&
    Array.isArray(value.issues) &&
    "warnings" in value &&
    Array.isArray(value.warnings)
  );
}

interface UseWorkItemGraphProposalReviewInput {
  organizationId: string;
  projectId: string;
  proposalId: string;
  updates: WorkItemChangeSetValidationRequest;
  enabled: boolean;
}

interface WorkItemGraphProposalReviewResult {
  reviewState: WorkItemGraphReviewState;
  retryValidation: () => void;
}

export function useWorkItemGraphProposalReview({
  organizationId,
  projectId,
  proposalId,
  updates,
  enabled,
}: UseWorkItemGraphProposalReviewInput): WorkItemGraphProposalReviewResult {
  // Keyed on content, not object identity: proposal refetches hand us a new
  // `updates` object with identical operations, which must not revalidate.
  const updatesKey = JSON.stringify(updates);
  const query = useQuery({
    queryKey: [
      "work-item-graph-proposal-review",
      organizationId,
      projectId,
      proposalId,
      updatesKey,
    ],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    queryFn: async () => {
      const response = await proposalsClient.validateProposal({
        organizationId,
        projectId,
        proposalId,
        workItemChangeSetValidationRequest: updates,
      });
      const result = response.data.data;
      if (!isProjection(result)) {
        throw new Error(
          "The proposal validation did not return a graph projection.",
        );
      }
      return result;
    },
  });

  // Query notifications are deferred; hide the failed review on the retry click.
  const [retrying, setRetrying] = useState(false);
  const { data, error, isError, isFetching, refetch } = query;
  const operations = updates.operations;
  const reviewState = useMemo<WorkItemGraphReviewState>(() => {
    if (retrying || isFetching) return { kind: "validating" };
    if (isError) {
      return workItemGraphReviewReducer(
        { kind: "validating" },
        { type: "validationFailed", error },
      );
    }
    if (!data) return { kind: "validating" };
    return workItemGraphReviewReducer(
      { kind: "validating" },
      { type: "validationSucceeded", response: data, operations },
    );
    // `operations` content is pinned by updatesKey, so `data` covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, error, isError, isFetching, retrying]);

  const retryValidation = useCallback(() => {
    setRetrying(true);
    void refetch().finally(() => setRetrying(false));
  }, [refetch]);

  return { reviewState, retryValidation };
}
