import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum,
  AgentSessionType,
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  EntityType,
  MessageType,
  WorkflowName,
  type AgentSessionConfigEntityConversationV1,
  type RunCreatePayloadEntityConversation,
} from "../../api";
import { useCreateAgentSession } from "../../data/hooks/useCreateAgentSession";
import { useCreateAgentSessionConversation } from "../../data/hooks/useCreateAgentSessionConversation";
import { useAgentSessionInteractionAccessResolver } from "../AgentSession/operations/useAgentSessionInteractionAccess";
import { usePathService } from "../../contexts";
import { getErrorMessage } from "../../utils/errorUtils";
import { getWorkflowAboutTypeForEntityType } from "../../utils/agentSessionUtils";
import { buildRunEntityReference } from "../AgentSession/runEntityReference";
import type { LineageContext } from "./types";
import type { GraphConversationLaunchInput } from "./graphConversationLaunchInput";
import { buildGoalEntityFields } from "./goalSnapshot";
import {
  resolveEntityTypeConfig,
  type LineageFieldMapping,
} from "./entityTypeRegistry";
import { bindGraphConversationAgentSessionMachine } from "./bindGraphConversationAgentSessionMachine";

// Defaults used when the caller omits model / reasoningEffort.
const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_REASONING_EFFORT =
  ConversationStartRunRequestDtoReasoningEffortEnum.Medium;

export interface UseEntityConversationLauncherInput {
  organizationId: string;
  projectId: string;
}

export interface UseEntityConversationLauncherResult {
  /** Returns `true` on success (navigated), `false` on failure. */
  launch: (input: EntityConversationLaunchInput) => Promise<boolean>;
  isLoading: boolean;
  error: EntityConversationLaunchError | null;
  clearError: () => void;
}

export interface EntityConversationLaunchError {
  code: string | null;
  message: string;
}

export interface EntityConversationLaunchInput extends GraphConversationLaunchInput {
  context: LineageContext;
}

export const useEntityConversationLauncher = ({
  organizationId,
  projectId,
}: UseEntityConversationLauncherInput): UseEntityConversationLauncherResult => {
  const navigate = useNavigate();
  const pathService = usePathService();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<EntityConversationLaunchError | null>(
    null,
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

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
      skillSelection,
      context,
      provider,
      model,
      reasoningEffort,
      machineId,
      serviceId,
      fastMode,
      projectAssistant,
      disableCodexSystemPrompt,
    }: EntityConversationLaunchInput): Promise<boolean> => {
      setIsLoading(true);
      setError(null);

      try {
        const interactionAccess =
          interactionAccessResolver.getAccess(machineId);
        if (!interactionAccess.isDeviceEnabled) {
          setError({
            code: "MACHINE_NOT_READY",
            message: interactionAccess.unavailable.message,
          });
          return false;
        }
        const config = resolveEntityTypeConfig(context.entityType);
        const mapping: LineageFieldMapping | undefined =
          config?.lineageFieldMapping;
        const normalisedEntityType = mapping?.entityType ?? context.entityType;
        const selectedModel = model ?? DEFAULT_MODEL;
        const agentSessionConfig = {
          type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
          version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
          model: selectedModel,
          ...(reasoningEffort ? { effort: reasoningEffort } : {}),
          ...(projectAssistant === undefined ? {} : { projectAssistant }),
          ...(disableCodexSystemPrompt === undefined
            ? {}
            : { disableCodexSystemPrompt }),
        } satisfies AgentSessionConfigEntityConversationV1;

        const entityTitle = context.entityTitle?.trim();
        const session = await createSessionRef.current({
          organizationId,
          agentSession: {
            projectId,
            sessionDate: new Date().toISOString(),
            ...(serviceId
              ? { serviceIds: [serviceId], launchServiceId: serviceId }
              : {}),
            ...(entityTitle ? { title: `Discuss ${entityTitle}` } : {}),
            ...(mapping ? { [mapping.sessionField]: context.entityId } : {}),
            ...(mapping?.sessionField === "entityId"
              ? { entityType: mapping.entityType.toUpperCase() as EntityType }
              : {}),
            provider,
            type: AgentSessionType.EntityConversation,
            config: agentSessionConfig,
          },
        });

        await bindGraphConversationAgentSessionMachine({
          organizationId,
          projectId,
          agentSessionId: session.id,
          machineId,
        });

        // A freshly created Agent Session must be bound through the conversation
        // endpoint. Do not trust a non-null conversationId from the create
        // response: reusing one would let a stale conversation (for example,
        // a plan conversation) become the owner of this launch.
        const { conversation } = await createSessionConversationRef.current({
          organizationId,
          projectId,
          agentSessionId: session.id,
          body: {
            workflowType: WorkflowName.AgentEntityConversation,
            workflowAboutType:
              getWorkflowAboutTypeForEntityType(normalisedEntityType) ??
              normalisedEntityType,
            workflowAboutId: context.entityId,
          },
        });
        const conversationId = conversation.id;

        // When the caller hands us a loaded goal DTO, decorate the entity
        // block so the agent prompt's goal-aware branches fire on the very
        // first turn — without a server-side task refetch. Other entity types
        // (or task launches whose surface lacks the DTO) keep the minimal
        // entity block and the new fields stay absent.
        const goalSnapshot =
          normalisedEntityType === "task" ? context.goalSnapshot : undefined;
        const taskType =
          normalisedEntityType.toUpperCase() === EntityType.Task
            ? context.entitySubtype
            : undefined;
        const payload: RunCreatePayloadEntityConversation = {
          entity: {
            ...buildRunEntityReference(normalisedEntityType, context.entityId),
            ...(taskType ? { taskType } : {}),
            ...(goalSnapshot ? buildGoalEntityFields(goalSnapshot) : {}),
          },
          userMessage: prompt,
          promptType: "entity_conversation",
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
              handlerPromptType: "entity_conversation",
              payload,
              model: selectedModel,
              config: agentSessionConfig,
              reasoningEffort:
                (reasoningEffort as ConversationStartRunRequestDtoReasoningEffortEnum | null) ??
                DEFAULT_REASONING_EFFORT,
              // TODO phase 4: thread provider into buildRunContext once non-Claude support lands
              provider: provider as ConversationStartRunRequestDtoProviderEnum,
              ...(skillSelection ? { skillSelection } : {}),
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
          setError({
            code:
              startRunResult.state === "cancelled"
                ? "CANCELLED"
                : startRunResult.code,
            message:
              startRunResult.state === "cancelled"
                ? "The operation was cancelled."
                : startRunResult.message,
          });
          return false;
        }

        navigate(
          pathService.entityConversation({
            projectId,
            agentSessionId: session.id,
            conversationId,
            entityId: context.entityId,
            entityType: normalisedEntityType,
          }),
        );
        return true;
      } catch (err) {
        setError({
          code: null,
          message: getErrorMessage(err, "Failed to start entity conversation."),
        });
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

  return { launch, isLoading, error, clearError };
};
