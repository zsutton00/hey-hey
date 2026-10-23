import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum,
  AgentSessionType,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  EntityType,
  LocalPromptType,
  WorkflowName,
  type AgentSessionConfigEntityConversationV1,
  type AgentSkillSelection,
  type ConversationStartRunRequestDtoProviderEnum,
  type ConversationStartRunRequestDtoReasoningEffortEnum as ReasoningEffort,
  type RunCreatePayloadHtmlCssMockupRevision,
} from "../../api";
import { useCreateAgentSession } from "../../data/hooks/useCreateAgentSession";
import { useCreateAgentSessionConversation } from "../../data/hooks/useCreateAgentSessionConversation";
import { usePathService } from "../../contexts";
import { getErrorMessage } from "../../utils/errorUtils";
import { useAgentSessionInteractionAccessResolver } from "../AgentSession/operations/useAgentSessionInteractionAccess";
import { bindGraphConversationAgentSessionMachine } from "../InteractionComponent/bindGraphConversationAgentSessionMachine";

export interface HtmlCssMockupRevisionLaunchInput {
  taskId: string;
  taskTitle: string;
  payload: RunCreatePayloadHtmlCssMockupRevision;
  provider: ConversationStartRunRequestDtoProviderEnum;
  model: string;
  reasoningEffort: ReasoningEffort | null;
  machineId: string;
  serviceId?: string;
  skillSelection?: AgentSkillSelection;
  fastMode?: boolean;
}

export const useHtmlCssMockupRevisionLauncher = ({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) => {
  const navigate = useNavigate();
  const paths = usePathService();
  const accessResolver = useAgentSessionInteractionAccessResolver();
  const { mutate: createSession } = useCreateAgentSession();
  const { mutate: createConversation } = useCreateAgentSessionConversation();
  const createSessionRef = useRef(createSession);
  const createConversationRef = useRef(createConversation);
  createSessionRef.current = createSession;
  createConversationRef.current = createConversation;
  const pending = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  const launch = useCallback(
    async (input: HtmlCssMockupRevisionLaunchInput): Promise<boolean> => {
      if (pending.current) return false;
      pending.current = true;
      setIsLoading(true);
      setError(null);
      try {
        const access = accessResolver.getAccess(input.machineId);
        if (!access.isDeviceEnabled) {
          setError(access.unavailable.message);
          return false;
        }
        const reasoningEffort =
          input.reasoningEffort ??
          ConversationStartRunRequestDtoReasoningEffortEnum.Medium;
        const config = {
          type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
          version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
          model: input.model,
          ...(input.reasoningEffort ? { effort: input.reasoningEffort } : {}),
          projectAssistant: { enabled: false },
        } satisfies AgentSessionConfigEntityConversationV1;
        const session = await createSessionRef.current({
          organizationId,
          agentSession: {
            projectId,
            sessionDate: new Date().toISOString(),
            title: `Revise ${input.taskTitle}`,
            type: AgentSessionType.EntityConversation,
            entityType: EntityType.Task,
            entityId: input.taskId,
            provider: input.provider,
            config,
            ...(input.serviceId
              ? { serviceId: input.serviceId, serviceIds: [input.serviceId] }
              : {}),
          },
        });
        await bindGraphConversationAgentSessionMachine({
          organizationId,
          projectId,
          agentSessionId: session.id,
          machineId: input.machineId,
        });
        const { conversation } = await createConversationRef.current({
          organizationId,
          projectId,
          agentSessionId: session.id,
          body: {
            workflowType: WorkflowName.AgentEntityConversation,
            workflowAboutType: "task",
            workflowAboutId: input.taskId,
          },
        });
        const result = await access.interactions.startSession({
          organizationId,
          projectId,
          agentSessionId: session.id,
          conversationId: conversation.id,
          intent: {
            attachments: [],
            handlerPromptType: LocalPromptType.HtmlCssMockupRevision,
            payload: input.payload,
            provider: input.provider,
            model: input.model,
            config,
            reasoningEffort,
            ...(input.skillSelection
              ? { skillSelection: input.skillSelection }
              : {}),
            ...(input.fastMode !== undefined
              ? { fastMode: input.fastMode }
              : {}),
            contextMetadata: {
              capturedAt: new Date().toISOString(),
              organizationId,
              projectId,
              agentSessionId: session.id,
              userComments: [],
              fileReferences: { resolved: [], unresolved: [] },
            },
            ...(input.serviceId
              ? {
                  serviceIds: [input.serviceId],
                  launchServiceId: input.serviceId,
                }
              : {}),
          },
        });
        if (result.state !== "succeeded" && result.state !== "accepted") {
          setError(
            result.state === "cancelled"
              ? "Mockup revision launch was cancelled."
              : result.message,
          );
          return false;
        }
        navigate(
          paths.entityConversation({
            projectId,
            agentSessionId: session.id,
            conversationId: conversation.id,
            entityId: input.taskId,
            entityType: EntityType.Task,
          }),
        );
        return true;
      } catch (failure) {
        setError(
          getErrorMessage(failure, "Could not start the mockup revision."),
        );
        return false;
      } finally {
        pending.current = false;
        setIsLoading(false);
      }
    },
    [accessResolver, navigate, organizationId, paths, projectId],
  );

  return { launch, isLoading, error, clearError };
};
