import type {
  DesignDocResponseDto,
  DesignDocParentEntityType,
} from "../../api";
import type { MutationOptions } from "../core/useMutation";
import type { AdrContent } from "../../types/adr";
import { adrContentToDesignDocSections } from "../../utils/adrDesignDocConversion";
import { useCreateDesignDoc } from "./useCreateDesignDoc";

interface CreateAdrDto {
  name: string;
  content: AdrContent;
  projectId?: string;
  tags?: string[];
  status?: string;
  summary?: string;
  parentEntityId?: string | null;
  parentEntityType?: DesignDocParentEntityType | null;
}

export interface CreateAdrVariables {
  organizationId: string;
  adr: CreateAdrDto;
}

export type UseCreateAdrOptions = MutationOptions<DesignDocResponseDto>;

export function useCreateAdr(options: UseCreateAdrOptions = {}) {
  const mutation = useCreateDesignDoc(options);
  const mutate = ({ organizationId, adr }: CreateAdrVariables) => {
    const { content, ...fields } = adr;
    return mutation.mutate({
      organizationId,
      designDoc: {
        ...fields,
        template: "ADR",
        sections: adrContentToDesignDocSections(content),
      },
    });
  };
  return { ...mutation, mutate };
}
