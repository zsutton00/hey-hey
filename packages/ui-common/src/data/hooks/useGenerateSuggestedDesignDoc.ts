import type {
  CreateSuggestedDesignDocRequestDto,
  CreateSuggestedDesignDocResponseDto,
} from "../../api";
import { suggestionsClient } from "../../clients/serviceClients";
import type { MutationOptions } from "../core/useMutation";
import { useMutation } from "../core/useMutation";

export interface GenerateSuggestedDesignDocVariables {
  organizationId: string;
  request: CreateSuggestedDesignDocRequestDto;
}

export type UseGenerateSuggestedDesignDocOptions =
  MutationOptions<CreateSuggestedDesignDocResponseDto>;

export const useGenerateSuggestedDesignDoc = (
  options: UseGenerateSuggestedDesignDocOptions = {}
) => {
  const mutationFn = async ({
    organizationId,
    request,
  }: GenerateSuggestedDesignDocVariables): Promise<CreateSuggestedDesignDocResponseDto> => {
    const response =
      await suggestionsClient.generateDesignDocSuggestion(
        {
          organizationId: organizationId,
          createSuggestedDesignDocRequestDto: request,
        }
      );

    const result = response.data?.data;
    if (!result) {
      throw new Error("No suggested design doc response returned from API");
    }

    return result;
  };

  return useMutation(mutationFn, options);
};
