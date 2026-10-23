import { useQueryClient } from "@tanstack/react-query";
import type { ProposalResponseDto } from "../../api";
import { dataClient } from "../../clients";
import type {
  DesignDocDraftSection,
  DesignDocResponseDto,
  UpdateDesignDocDto,
} from "../../api";
import type { MutationOptions } from "../core/useMutation";
import { useMutation } from "../core/useMutation";
import {
  writeDesignDoc,
  snapshotDesignDocs,
  findDesignDoc,
  invalidateDesignDocQueries,
} from "../collections/designDocs";
import { useRelationshipMutationInvalidation } from "./relationshipMutationInvalidation";

export const ENTITY_TYPE = "DesignDoc";

/**
 * Whether the PATCH was applied immediately or staged behind a pending
 * proposal. Mirrors the generated `UpdateTaskResultStatus`. Defined locally
 * until the backend lands `UpdateDesignDocResponseDto` in the shared OpenAPI
 * spec and the client is regenerated, at which point this is replaced by the
 * generated enum.
 */
export const UpdateDesignDocResultStatus = {
  Applied: "APPLIED",
  Pending: "PENDING",
} as const;

export type UpdateDesignDocResultStatus =
  (typeof UpdateDesignDocResultStatus)[keyof typeof UpdateDesignDocResultStatus];

/**
 * Envelope the design-doc PATCH now returns: the result status, the design
 * doc (the applied state, or the unchanged state when staged behind a
 * proposal), and the pending proposal when one was created. Locally defined
 * until the regenerated client supplies it.
 */
export interface UpdateDesignDocResponseDto {
  status: UpdateDesignDocResultStatus;
  designDoc: DesignDocResponseDto;
  proposal?: ProposalResponseDto;
}

export interface UpdateDesignDocVariables {
  organizationId: string;
  designDocId: string;
  updates: UpdateDesignDocRequest;
}

export interface UpdateDesignDocRequest extends UpdateDesignDocDto {
  sections?: DesignDocDraftSection[];
  metadata?: { [key: string]: unknown };
}

export type UseUpdateDesignDocOptions =
  MutationOptions<UpdateDesignDocResponseDto>;

/**
 * Normalizes the PATCH payload to the envelope shape. Tolerates the legacy
 * bare-`DesignDocResponseDto` body during the backend rollout — once every
 * environment returns the envelope, the bare-doc branch is dead and removable.
 */
export const toEnvelope = (
  payload: UpdateDesignDocResponseDto | DesignDocResponseDto | null | undefined
): UpdateDesignDocResponseDto => {
  if (!payload) {
    throw new Error("No design doc returned from update endpoint");
  }

  if ("status" in payload && "designDoc" in payload) {
    return payload;
  }

  return {
    status: UpdateDesignDocResultStatus.Applied,
    designDoc: payload,
  };
};

export function useUpdateDesignDoc(options: UseUpdateDesignDocOptions = {}) {
  const queryClient = useQueryClient();
  const invalidateRelationships = useRelationshipMutationInvalidation();

  const mutationFn = async ({
    organizationId,
    designDocId,
    updates,
  }: UpdateDesignDocVariables): Promise<UpdateDesignDocResponseDto> => {
    const previous = findDesignDoc(queryClient, organizationId, designDocId);
    const restore = await snapshotDesignDocs(
      queryClient,
      organizationId,
      designDocId
    );
    try {
      const response = await dataClient.request<{
        data?: UpdateDesignDocResponseDto | DesignDocResponseDto | null;
      }>({
        method: "PATCH",
        url: `/organizations/${organizationId}/design-docs/${designDocId}`,
        data: updates,
      });

      const envelope = toEnvelope(response.data?.data);
      const updatedDoc = envelope.designDoc;

      writeDesignDoc(queryClient, organizationId, updatedDoc);

      if (envelope.status === UpdateDesignDocResultStatus.Applied) {
        void invalidateDesignDocQueries(
          queryClient,
          organizationId,
          updatedDoc.projectId ?? undefined,
          updatedDoc.id,
          previous?.projectId ?? undefined
        );
        invalidateRelationships({
          entityType: ENTITY_TYPE,
          operation: "update",
          sourceEntity: updatedDoc,
          organizationId,
        });
      }

      return envelope;
    } catch (error) {
      restore();
      throw error;
    }
  };

  return useMutation(mutationFn, options);
}
