import type { DesignDocSectionUpdateSource } from "../../api";
import type { AdrContent } from "../../types/adr";
import {
  useUpdateDesignDoc,
  type UpdateDesignDocResponseDto,
} from "./useUpdateDesignDoc";
import type { MutationOptions } from "../core/useMutation";

interface UpdateAdrDto {
  name?: string;
  content?: Partial<AdrContent>;
  projectId?: string;
  tags?: string[];
  status?: string;
  metadata?: { [key: string]: unknown };
  sectionUpdateSource?: DesignDocSectionUpdateSource;
  /** Optional note explaining the change, forwarded to the proposal. */
  reason?: string;
}

export interface UpdateAdrVariables {
  organizationId: string;
  adrId: string;
  updates: UpdateAdrDto;
}

export type UseUpdateAdrOptions = MutationOptions<UpdateDesignDocResponseDto>;

export function useUpdateAdr(options: UseUpdateAdrOptions = {}) {
  const mutation = useUpdateDesignDoc(options);
  const mutate = ({ organizationId, adrId, updates }: UpdateAdrVariables) => {
    const { content, ...fields } = updates;
    const entries = Object.entries(content ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    return mutation.mutate({
      organizationId,
      designDocId: adrId,
      updates: {
        ...fields,
        sections: entries.map(([key, content], order) => ({
          key,
          content,
          order,
        })),
      },
    });
  };
  return { ...mutation, mutate };
}
