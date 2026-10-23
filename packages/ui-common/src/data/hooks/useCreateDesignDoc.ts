import { useQueryClient } from "@tanstack/react-query";
import type { CreateDesignDoc201Response } from "../../api";
import { dataClient } from "../../clients";
import type { CreateDesignDocDto, DesignDocResponseDto } from "../../api";
import type { MutationOptions } from "../core/useMutation";
import { useMutation } from "../core/useMutation";
import {
  writeDesignDoc,
  invalidateDesignDocQueries,
} from "../collections/designDocs";
import { useRelationshipMutationInvalidation } from "./relationshipMutationInvalidation";

export const ENTITY_TYPE = "DesignDoc";

export interface CreateDesignDocVariables {
  organizationId: string;
  designDoc: CreateDesignDocDto;
}

export type UseCreateDesignDocOptions = MutationOptions<DesignDocResponseDto>;

export function useCreateDesignDoc(options: UseCreateDesignDocOptions = {}) {
  const queryClient = useQueryClient();
  const invalidateRelationships = useRelationshipMutationInvalidation();

  const mutationFn = async ({
    organizationId,
    designDoc,
  }: CreateDesignDocVariables): Promise<DesignDocResponseDto> => {
    const response = await dataClient.request<CreateDesignDoc201Response>({
      method: "POST",
      url: `/organizations/${organizationId}/design-docs`,
      data: designDoc,
    });

    const createdDoc = response.data?.data;

    if (!createdDoc) {
      throw new Error("No design doc returned from create endpoint");
    }

    writeDesignDoc(queryClient, organizationId, createdDoc);
    void invalidateDesignDocQueries(
      queryClient,
      organizationId,
      createdDoc.projectId ?? undefined,
      createdDoc.id
    );

    invalidateRelationships({
      entityType: ENTITY_TYPE,
      operation: "create",
      sourceEntity: createdDoc,
      organizationId,
    });

    return createdDoc;
  };

  return useMutation(mutationFn, options);
}
