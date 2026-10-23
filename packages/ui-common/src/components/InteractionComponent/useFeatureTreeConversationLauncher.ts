import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AgentSessionType,
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  MessageType,
  WorkflowName,
  type RunCreatePayloadFeatureTreeConversation,
} from "../../api";
import { useCreateAgentSession } from "../../data/hooks/useCreateAgentSession";
import { useCreateAgentSessionConversation } from "../../data/hooks/useCreateAgentSessionConversation";
import { useAgentSessionInteractionAccessResolver } from "../AgentSession/operations/useAgentSessionInteractionAccess";
import { usePathService } from "../../contexts";
import { buildRunEntityReference } from "../AgentSession/runEntityReference";
import type { GraphConversationLaunchInput } from "./graphConversationLaunchInput";
import { bindGraphConversationAgentSessionMachine } from "./bindGraphConversationAgentSessionMachine";

const DEFAULT_PROVIDER = ConversationStartRunRequestDtoProviderEnum.Claude;
const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_REASONING_EFFORT =
  ConversationStartRunRequestDtoReasoningEffortEnum.Medium;

export interface UseFeatureTreeConversationLauncherInput {
  organizationId: string;
  projectId: string;
}

export interface UseFeatureTreeConversationLauncherResult {
  /** Returns `true` on success (navigated), `false` on failure. */
  launch: (input: FeatureTreeConversationLaunchInput) => Promise<boolean>;
  isLoading: boolean;
  error: string | null;
}

export type FeatureTreeConversationLaunchInput = GraphConversationLaunchInput;

export const useFeatureTreeConversationLauncher = ({
  organizationId,
  projectId,
}: UseFeatureTreeConversationLauncherInput): UseFeatureTreeConversationLauncherResult => {
  const navigate = useNavigate();
  const pathService = usePathService();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { mutate: createSessionMutate } = useCreateAgentSession();
  const createSessionRef = useRef(createSessionMutate);
  createSessionRef.current = createSessionMutate;

  const { mutate: createSessionConversationMutate } =
    useCreateAgentSessionConversation();
  const createSessionConversationRef = useRef(createSessionConversationMutate);
  createSessionConversationRef.current = createSessionConversationMutate;

  const interactionAccessResolver = useAgentSessionInteractionAccessResolver();

  const launch = useCallback(
    async ({
      prompt,
      attachments = [],
      stagedBrowserTab = null,
      provider,
      model,
      reasoningEffort,
      machineId,
      serviceId,
      fastMode,
    }: FeatureTreeConversationLaunchInput): Promise<boolean> => {
      setIsLoading(true);
      setError(null);

      try {
        const interactionAccess =
          interactionAccessResolver.getAccess(machineId);
        if (!interactionAccess.isDeviceEnabled) {
          setError(interactionAccess.unavailable.message);
          return false;
        }
        const session = await createSessionRef.current({
          organizationId,
          agentSession: {
            projectId,
            sessionDate: new Date().toISOString(),
            title: "Discuss Feature Tree",
            type: AgentSessionType.ProjectConversation,
            ...(serviceId
              ? { serviceIds: [serviceId], launchServiceId: serviceId }
              : {}),
          },
        });

        await bindGraphConversationAgentSessionMachine({
          organizationId,
          projectId,
          agentSessionId: session.id,
          machineId,
        });

        let conversationId = session.conversationId;
        if (!conversationId) {
          const { conversation } = await createSessionConversationRef.current({
            organizationId,
            projectId,
            agentSessionId: session.id,
            body: {
              workflowType: WorkflowName.FeatureTreeConversation,
            },
          });
          conversationId = conversation.id;
        }
        const payload: RunCreatePayloadFeatureTreeConversation = {
          entity: buildRunEntityReference("PROJECT", projectId),
          projectId,
          userMessage: prompt,
          promptType: "feature_tree_conversation",
        };

        const startRunResult =
          await interactionAccess.interactions.startSession({
            organizationId,
            projectId,
            conversationId,
            agentSessionId: session.id,
            intent: {
              attachments,
              stagedBrowserTab,
              handlerPromptType: "feature_tree_conversation",
              payload,
              model: model ?? DEFAULT_MODEL,
              reasoningEffort:
                (reasoningEffort as ConversationStartRunRequestDtoReasoningEffortEnum | null) ??
                DEFAULT_REASONING_EFFORT,
              provider:
                (provider as ConversationStartRunRequestDtoProviderEnum | null) ??
                DEFAULT_PROVIDER,
              ...(fastMode !== undefined ? { fastMode } : {}),
              contextMetadata: {
                capturedAt: new Date().toISOString(),
                organizationId,
                projectId,
                agentSessionId: session.id,
                userComments: [],
                fileReferences: { resolved: [], unresolved: [] },
              },
              ...(serviceId
                ? { serviceIds: [serviceId], launchServiceId: serviceId }
                : {}),
              initialMessage: { role: MessageType.User },
            },
          });

        if (
          startRunResult.state !== "succeeded" &&
          startRunResult.state !== "accepted"
        ) {
          setError(
            startRunResult.state === "cancelled"
              ? "The operation was cancelled."
              : startRunResult.message,
          );
          return false;
        }

        navigate(
          pathService.agentSession({
            projectId,
            agentSessionId: session.id,
          }),
        );
        return true;
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to start feature tree conversation.",
        );
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [
      interactionAccessResolver,
      navigate,
      organizationId,
      pathService,
      projectId,
    ],
  );

  return { launch, isLoading, error };
};
