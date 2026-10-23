import type { ProposalResponseDto, WorkItemTypeDefinitionDto } from "../../api";
import { getApiRuntime } from "../../clients";
import type { MutationOptions } from "../core/useMutation";
import { useMutation } from "../core/useMutation";

export interface CreateWorkItemTypeVariables {
  organizationId: string;
  projectId: string;
  definition: WorkItemTypeDefinitionDto;
}

export type UseCreateWorkItemTypeOptions = MutationOptions<ProposalResponseDto>;

export function useCreateWorkItemType(
  options: UseCreateWorkItemTypeOptions = {}
) {
  const mutationFn = async ({
    organizationId,
    projectId,
    definition,
  }: CreateWorkItemTypeVariables): Promise<ProposalResponseDto> => {
    const response =
      await getApiRuntime().clients.workItemTypes.organizationsOrganizationIdProjectsProjectIdWorkItemTypesPost(
        {
          organizationId,
          projectId,
          workItemTypeDefinitionDto: definition,
        }
      );

    const proposal = response.data?.data;

    if (!proposal) {
      throw new Error(
        "No proposal returned from create work-item-type endpoint"
      );
    }

    // The POST funnels the definition through a WORK_ITEM_TYPE proposal rather
    // than mutating the registry, so there is no registry item to seed into the
    // workItemTypes collection — the created type only materializes once the
    // proposal is approved.
    return proposal as ProposalResponseDto;
  };

  return useMutation(mutationFn, options);
}
