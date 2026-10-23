import { useQueryClient } from "@tanstack/react-query";
import type { CreateDesignDoc201Response } from "../../api";
import { dataClient } from "../../clients";
import type { DesignDocResponseDto } from "../../api";
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

export interface DeleteDesignDocVariables {
  organizationId: string;
  designDocId: string;
}

export type UseDeleteDesignDocOptions = MutationOptions<DesignDocResponseDto>;

export function useDeleteDesignDoc(options: UseDeleteDesignDocOptions = {}) {
  const queryClient = useQueryClient();
  const invalidateRelationships = useRelationshipMutationInvalidation();

  const mutationFn = async ({
    organizationId,
    designDocId,
  }: DeleteDesignDocVariables): Promise<DesignDocResponseDto> => {
    const previous = findDesignDoc(queryClient, organizationId, designDocId);
    const restore = await snapshotDesignDocs(
      queryClient,
      organizationId,
      designDocId
    );
    writeDesignDoc(queryClient, organizationId, null, designDocId);
    try {
      const response = await dataClient.request<CreateDesignDoc201Response>({
        method: "DELETE",
        url: `/organizations/${organizationId}/design-docs/${designDocId}`,
      });

      const archivedDoc = response.data?.data;

      if (!archivedDoc) {
        throw new Error("No design doc returned from delete endpoint");
      }

      void invalidateDesignDocQueries(
        queryClient,
        organizationId,
        previous?.projectId ?? archivedDoc.projectId ?? undefined,
        designDocId
      );

      invalidateRelationships({
        entityType: ENTITY_TYPE,
        operation: "delete",
        sourceEntity: archivedDoc,
        organizationId,
      });

      return archivedDoc;
    } catch (error) {
      restore();
      throw error;
    }
  };

  return useMutation(mutationFn, options);
}
