import { useQueryClient } from "@tanstack/react-query";
import { invalidateProposalLists } from "../collections/proposals";
import { useCallback, useRef, useState } from "react";
import {
  ProposalAction,
  ProposalType,
  TargetEntityType,
  type ProjectedWorkItem,
  type ProposalResponseDto,
  type WorkItemChangeSetOperation,
  type WorkItemChangeSetValidationRequest,
  type WorkItemTypeGraphCapability,
} from "../../api";
import type { WorkItemGraphDraftProjection } from "../../components/shared/workItemGraphDraft";
import { proposalsClient } from "../../clients/serviceClients";

export type SubmitWorkItemGraphProposalErrorCode =
  | "missing_organization"
  | "missing_project"
  | "missing_root"
  | "missing_graph_capability"
  | "missing_draft"
  | "no_changes"
  | "invalid_projection"
  | "missing_proposal";

export class SubmitWorkItemGraphProposalError extends Error {
  constructor(
    readonly code: SubmitWorkItemGraphProposalErrorCode,
    message: string
  ) {
    super(message);
    this.name = "SubmitWorkItemGraphProposalError";
  }
}

export interface SubmitWorkItemGraphProposalInput {
  eli5: string;
  organizationId: string | null | undefined;
  projectId: string | null | undefined;
  root: ProjectedWorkItem | null | undefined;
  graphCapability: WorkItemTypeGraphCapability | null | undefined;
  draft: WorkItemGraphProposalDraft | null | undefined;
}

export interface WorkItemGraphProposalDraft {
  operations: readonly WorkItemChangeSetOperation[];
  projection: WorkItemGraphDraftProjection;
  isDirty: boolean;
}

export interface UseSubmitWorkItemGraphProposalReturn {
  submit: (
    input: SubmitWorkItemGraphProposalInput
  ) => Promise<ProposalResponseDto>;
  isPending: boolean;
  error: Error | null;
}

function requireNonEmpty(
  value: string | null | undefined,
  code: Extract<
    SubmitWorkItemGraphProposalErrorCode,
    "missing_organization" | "missing_project"
  >,
  message: string
): string {
  if (!value?.trim()) {
    throw new SubmitWorkItemGraphProposalError(code, message);
  }
  return value;
}

interface GraphProposalSubmission {
  action: ProposalAction;
  targetEntityId: string;
  title: string;
  updates: WorkItemChangeSetValidationRequest;
}

function buildSubmission(
  input: SubmitWorkItemGraphProposalInput
): GraphProposalSubmission {
  if (!input.root) {
    throw new SubmitWorkItemGraphProposalError(
      "missing_root",
      "A root work item is required to submit graph changes."
    );
  }
  if (!input.graphCapability) {
    throw new SubmitWorkItemGraphProposalError(
      "missing_graph_capability",
      "A resolved graph capability is required to submit graph changes."
    );
  }
  if (!input.draft) {
    throw new SubmitWorkItemGraphProposalError(
      "missing_draft",
      "A complete graph draft is required for review."
    );
  }
  if (!input.draft.isDirty || input.draft.operations.length === 0) {
    throw new SubmitWorkItemGraphProposalError(
      "no_changes",
      "The graph draft does not contain changes to review."
    );
  }
  if (
    !input.draft.projection.valid ||
    input.draft.projection.issues.length > 0 ||
    JSON.stringify(input.draft.projection.projectedRoot.identity) !==
      JSON.stringify(input.root.identity)
  ) {
    throw new SubmitWorkItemGraphProposalError(
      "invalid_projection",
      "The complete projected graph must be valid before review."
    );
  }

  return {
    action:
      input.root.identity.refType === "temporary"
        ? ProposalAction.Create
        : ProposalAction.Update,
    targetEntityId:
      input.root.identity.refType === "temporary"
        ? "00000000-0000-0000-0000-000000000000"
        : input.root.identity.id,
    title: input.root.name,
    updates: {
      root: input.root.identity,
      operations: [...input.draft.operations],
      layoutBoundary: input.draft.projection.children
        .filter((child) => !child.deleted)
        .map((child) => child.identity),
    },
  };
}

export function useSubmitWorkItemGraphProposal(): UseSubmitWorkItemGraphProposalReturn {
  const queryClient = useQueryClient();
  const inFlightRef = useRef<Promise<ProposalResponseDto> | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const submit = useCallback(
    (input: SubmitWorkItemGraphProposalInput): Promise<ProposalResponseDto> => {
      if (inFlightRef.current) return inFlightRef.current;

      let organizationId: string;
      let projectId: string;
      let submission: GraphProposalSubmission;
      try {
        organizationId = requireNonEmpty(
          input.organizationId,
          "missing_organization",
          "An organization is required to submit graph changes."
        );
        projectId = requireNonEmpty(
          input.projectId,
          "missing_project",
          "A project is required to submit graph changes."
        );
        submission = buildSubmission(input);
      } catch (validationError) {
        const resolvedError =
          validationError instanceof Error
            ? validationError
            : new Error("Graph proposal submission is invalid.");
        setError(resolvedError);
        return Promise.reject(resolvedError);
      }

      setError(null);
      setIsPending(true);

      const request = proposalsClient
        .createProposal({
          organizationId: organizationId,
          projectId: projectId,
          createProposalRequestDto: {
            type: ProposalType.Batch,
            action: submission.action,
            eli5: input.eli5,
            targetEntityId: submission.targetEntityId,
            targetEntityType: TargetEntityType.Task,
            title: submission.title,
            updates: submission.updates,
          },
        })
        .then(async (response) => {
          const proposal = response.data.data;
          if (!proposal) {
            throw new SubmitWorkItemGraphProposalError(
              "missing_proposal",
              "The proposal endpoint did not return a review."
            );
          }
          await invalidateProposalLists(queryClient, organizationId, projectId);
          return proposal;
        })
        .catch((requestError: unknown) => {
          const resolvedError =
            requestError instanceof Error
              ? requestError
              : new Error("Graph proposal submission failed.");
          setError(resolvedError);
          throw resolvedError;
        })
        .finally(() => {
          inFlightRef.current = null;
          setIsPending(false);
        });

      inFlightRef.current = request;
      return request;
    },
    [queryClient]
  );

  return { submit, isPending, error };
}
