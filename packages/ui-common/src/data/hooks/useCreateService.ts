import { useQueryClient } from "@tanstack/react-query";
import type { CreateServiceDto, ServiceDto } from "../../api";
import { getApiRuntime } from "../../clients";
import type { MutationOptions } from "../core/useMutation";
import { useMutation } from "../core/useMutation";
import { serviceKeys } from "../collections/services";
import { useRelationshipMutationInvalidation } from "./relationshipMutationInvalidation";

export const ENTITY_TYPE = "Service";

export interface CreateServiceVariables {
  organizationId: string;
  service: CreateServiceDto;
}

export type UseCreateServiceOptions = MutationOptions<ServiceDto>;

export function useCreateService(options: UseCreateServiceOptions = {}) {
  const queryClient = useQueryClient();
  const invalidateRelationships = useRelationshipMutationInvalidation();

  const mutationFn = async ({
    organizationId,
    service,
  }: CreateServiceVariables): Promise<ServiceDto> => {
    const response = await getApiRuntime().clients.services.createService({
      organizationId,
      createServiceDto: service,
    });

    const createdService = response.data?.data;

    if (!createdService) {
      throw new Error("No service returned from create endpoint");
    }

    queryClient.setQueryData(
      serviceKeys.byId(organizationId, createdService.id),
      createdService
    );
    void queryClient.invalidateQueries({
      queryKey: serviceKeys.lists(organizationId),
    });

    invalidateRelationships({
      entityType: ENTITY_TYPE,
      operation: "create",
      sourceEntity: createdService,
      organizationId,
    });

    return createdService;
  };

  return useMutation(mutationFn, options);
}
