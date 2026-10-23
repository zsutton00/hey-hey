import {
  type CreateInitiativeDto,
  type InitiativeResponseDto,
  type UpdateInitiativeDto,
  WorkStatus,
} from "../../api";
import { type WorkItemSectionKey } from "../../utils/workItemSections";
import { initiativesQueryOptions } from "../collections/initiatives";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
  MutationCallbacks,
} from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import {
  useInitiativeCreate,
  useInitiativeRemove,
  useInitiativeUpdate,
} from "./initiativeMutations";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";
export const ENTITY_TYPE = "Initiative";
export interface UseInitiativesReturn
  extends Omit<DataCollectionHookReturn<InitiativeResponseDto>, "data"> {
  initiatives: InitiativeResponseDto[];
  create: (
    newInitiative: CreateInitiativeDto,
    callbacks?: MutationCallbacks<InitiativeResponseDto>
  ) => Promise<InitiativeResponseDto>;
  update: (
    id: string,
    updates: UpdateInitiativeDto,
    callbacks?: MutationCallbacks<InitiativeResponseDto>
  ) => Promise<InitiativeResponseDto>;
  remove: (id: string, callbacks?: MutationCallbacks<void>) => Promise<void>;
}
type Options = CollectionHookOptions<InitiativeResponseDto> & {
  includeDesignDocCounts?: boolean;
  includeSectionKeys?: WorkItemSectionKey[];
  websocketsEnabled?: boolean;
  status?: WorkStatus | WorkStatus[];
};
export function useInitiatives(
  organizationId: string,
  projectId: string,
  conversationId?: string,
  options: Options = {}
): UseInitiativesReturn {
  const readOptions = initiativesQueryOptions(organizationId, {
    projectId,
    conversationId,
    status: options.status,
    includeSectionKeys: options.includeSectionKeys,
  });
  const queryKey = readOptions.queryKey;
  const { result, state: query } = useDataLayerQuery(readOptions, {
    ...options,
    enabled:
      options.enabled !== false &&
      !!organizationId &&
      (!conversationId || !!projectId),
  });
  const update = useInitiativeUpdate(organizationId, projectId);
  const create = useInitiativeCreate(organizationId, projectId, queryKey);
  const remove = useInitiativeRemove(organizationId, projectId, queryKey);
  const initiatives = result.data ?? [];
  useWebsocketSubscriptions(
    {
      projectIds: projectId ? [projectId] : [],
      initiativeIds: initiatives.map((item) => item.id),
      conversationIds: conversationId ? [conversationId] : [],
    },
    {
      enabled: options.websocketsEnabled !== false && options.enabled !== false,
    }
  );
  return { ...query, initiatives, create, update, remove };
}
