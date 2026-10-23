import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConversationResponseDto,
  RefineWorkItem200Response,
} from "../../api";
import { workItemRefinementClient } from "../../clients/serviceClients";
import type { UseConversationReturn } from "./useConversation";
import { useConversation } from "./useConversation";
import { useConversationPolling } from "./useConversationPolling";
import { useProject } from "./useProject";
import type { WorkItemHookOptions, UseWorkItemsReturn } from "./useWorkItems";
import { useWorkItems } from "./useWorkItems";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

type WorkItemEntityType = "initiative" | "task";

export interface UseWorkItemRefinementDataParams {
  organizationId: string;
  projectId: string;
  workItemId: string;
  entityType: WorkItemEntityType;
}

export interface UseWorkItemRefinementDataReturn {
  project: ReturnType<typeof useProject>["data"];
  isProjectLoading: boolean;
  projectError: ReturnType<typeof useProject>["error"];

  workItemData: UseWorkItemsReturn["workItems"][number] | null;
  isWorkItemLoading: boolean;
  workItemError: UseWorkItemsReturn["error"];
  refetchWorkItem: UseWorkItemsReturn["refetch"];

  conversation: ConversationResponseDto | null;
  isConversationLoading: boolean;
  conversationError: UseConversationReturn["error"];
  refetchConversation: () => Promise<void>;

  refinementData: RefineWorkItem200Response["data"] | null;
  refinementError: Error | null;
  isStartingRefinement: boolean;

  isWaitingForFirstMessage: boolean;
}

const RESET_DEPENDENCY_SEPARATOR = ":";

export const useWorkItemRefinementData = ({
  organizationId,
  projectId,
  workItemId,
  entityType,
}: UseWorkItemRefinementDataParams): UseWorkItemRefinementDataReturn => {
  const [refinementData, setRefinementData] = useState<
    RefineWorkItem200Response["data"] | null
  >(null);
  const [refinementError, setRefinementError] = useState<Error | null>(null);
  const [isStartingRefinement, setIsStartingRefinement] = useState(false);
  const refinementRequestRef = useRef(false);
  const resetKeyRef = useRef<string>("");

  const resetKey = [organizationId, projectId, workItemId, entityType].join(
    RESET_DEPENDENCY_SEPARATOR
  );

  useEffect(() => {
    if (resetKeyRef.current === resetKey) {
      return;
    }

    resetKeyRef.current = resetKey;
    refinementRequestRef.current = false;
    setRefinementData(null);
    setRefinementError(null);
  }, [resetKey]);

  const {
    data: project,
    isLoading: isProjectLoading,
    error: projectError,
  } = useProject(organizationId, projectId);

  const workItemsOptions: WorkItemHookOptions | undefined =
    entityType === "task" ? { enabled: false } : undefined;

  const {
    workItems,
    isLoading: isWorkItemLoading,
    error: workItemError,
    refetch: refetchWorkItem,
  } = useWorkItems(
    organizationId,
    entityType,
    projectId,
    undefined,
    workItemsOptions
  );

  const workItemData = useMemo(() => {
    if (!workItems?.length) {
      return null;
    }

    return workItems.find((item) => item.id === workItemId) ?? null;
  }, [workItems, workItemId]);

  useEffect(() => {
    if (
      !organizationId ||
      !projectId ||
      !workItemId ||
      refinementData ||
      refinementRequestRef.current
    ) {
      return;
    }

    let cancelled = false;
    const startRefinement = async (): Promise<void> => {
      refinementRequestRef.current = true;
      setIsStartingRefinement(true);
      setRefinementError(null);

      try {
        const response = await workItemRefinementClient.refineWorkItem({
          organizationId: organizationId,
          projectId: projectId,
          entityType: entityType,
          entityId: workItemId,
        });
        const data = response.data.data;
        if (!cancelled) {
          if (data?.conversationId) {
            setRefinementData(data);
          } else {
            throw new Error(
              "Refinement response did not include a conversationId"
            );
          }
        }
      } catch (error) {
        if (!cancelled) {
          setRefinementError(
            error instanceof Error
              ? error
              : new Error(String(error ?? "Unknown error"))
          );
        }
      } finally {
        if (!cancelled) {
          refinementRequestRef.current = false;
          setIsStartingRefinement(false);
        }
      }
    };

    void startRefinement();

    return () => {
      cancelled = true;
    };
  }, [organizationId, projectId, workItemId, entityType, refinementData]);

  const conversationId = refinementData?.conversationId;

  const conversationResult = useConversation(
    organizationId,
    projectId,
    { conversationId: conversationId ?? "" },
    { enabled: !!conversationId }
  );

  const conversation = (conversationResult.data ??
    null) as ConversationResponseDto | null;

  const refetchConversation = useCallback(async () => {
    await conversationResult.refetch();
  }, [conversationResult]);

  const { isWaitingForFirstMessage } = useConversationPolling(conversation, {
    enabled:
      !!conversation && !!organizationId && !!projectId && !!conversationId,
    onPoll: refetchConversation,
  });

  useWebsocketSubscriptions(
    {
      conversationIds: conversationId ? [conversationId] : [],
      projectIds: projectId ? [projectId] : [],
    },
    {
      enabled: !!conversationId,
    }
  );

  return {
    project,
    isProjectLoading,
    projectError,
    workItemData,
    isWorkItemLoading,
    workItemError,
    refetchWorkItem,
    conversation,
    isConversationLoading: conversationResult.isLoading,
    conversationError: conversationResult.error,
    refetchConversation,
    refinementData,
    refinementError,
    isStartingRefinement,
    isWaitingForFirstMessage,
  };
};
