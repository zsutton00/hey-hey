import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum,
  AgentSessionType,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  EntityType,
  MessageType,
  WorkflowName,
  type AgentSessionConfigEntityConversationV1,
  type RunCreatePayloadVerifyFeature,
  type VerifyFeaturePayload,
} from "../../api";
import { useCreateAgentSession } from "../../data/hooks/useCreateAgentSession";
import { useCreateAgentSessionConversation } from "../../data/hooks/useCreateAgentSessionConversation";
import { useAgentSessionInteractionAccessResolver } from "../AgentSession/operations/useAgentSessionInteractionAccess";
import { usePathService } from "../../contexts";
import { getErrorMessage } from "../../utils/errorUtils";
import { bindGraphConversationAgentSessionMachine } from "./bindGraphConversationAgentSessionMachine";
import type { GraphConversationLaunchInput } from "./graphConversationLaunchInput";

export interface FeatureSyncLaunchInput extends GraphConversationLaunchInput {
  check: VerifyFeaturePayload;
  /** The session whose work raised the concern; the mode reads it itself. */
  parentAgentSessionId: string;
  serviceIds?: string[];
  launchServiceId?: string;
}

const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_REASONING_EFFORT =
  ConversationStartRunRequestDtoReasoningEffortEnum.Medium;

const buildServiceScope = ({
  serviceId,
  serviceIds,
  launchServiceId,
}: Pick<
  FeatureSyncLaunchInput,
  "serviceId" | "serviceIds" | "launchServiceId"
>): {
  serviceIds?: string[];
  launchServiceId?: string;
} => ({
  ...(serviceIds?.length
    ? { serviceIds }
    : serviceId
      ? { serviceIds: [serviceId] }
      : {}),
  ...(launchServiceId
    ? { launchServiceId }
    : serviceId
      ? { launchServiceId: serviceId }
      : {}),
});

export function useFeatureSyncConversationLauncher({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const navigate = useNavigate();
  const paths = usePathService();
  const accessResolver = useAgentSessionInteractionAccessResolver();
  const { mutate: createSession } = useCreateAgentSession();
  const { mutate: createConversation } = useCreateAgentSessionConversation();
  const createSessionRef = useRef(createSession);
  createSessionRef.current = createSession;
  const createConversationRef = useRef(createConversation);
  createConversationRef.current = createConversation;
  const [isLoading, setIsLoading] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);
  const launch = useCallback(
    async (input: FeatureSyncLaunchInput): Promise<boolean> => {
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
        const scope = buildServiceScope(input);
        const model = input.model ?? DEFAULT_MODEL;
        const reasoningEffort =
          input.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
        const config = {
          type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
          version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
          model,
          ...(input.reasoningEffort ? { effort: input.reasoningEffort } : {}),
          ...(input.projectAssistant === undefined
            ? {}
            : { projectAssistant: input.projectAssistant }),
          ...(input.disableCodexSystemPrompt === undefined
            ? {}
            : { disableCodexSystemPrompt: input.disableCodexSystemPrompt }),
          verifyFeature: {
            concern: input.check.explanation,
            parentAgentSessionId: input.parentAgentSessionId,
            impactedEntities: input.check.impactedEntities,
          },
        } satisfies AgentSessionConfigEntityConversationV1;
        const featureId = input.check.feature.entityId;
        const session = await createSessionRef.current({
          organizationId,
          agentSession: {
            projectId,
            sessionDate: new Date().toISOString(),
            title: "Verify Feature",
            type: AgentSessionType.EntityConversation,
            entityType: EntityType.Task,
            entityId: featureId,
            provider: input.provider,
            config,
            ...scope,
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
            // Features are TASK subtypes at the workflow-about boundary; keep
            // the more specific FEATURE identity in the run payload below.
            workflowAboutType: "task",
            workflowAboutId: featureId,
          },
        });
        const payload: RunCreatePayloadVerifyFeature = {
          entity: { entityType: EntityType.Task, entityId: featureId },
          concern: input.check.explanation,
          parentAgentSessionId: input.parentAgentSessionId,
          impactedEntities: input.check.impactedEntities,
          userMessage: input.prompt,
          promptType: "verify_feature",
        };
        const result = await access.interactions.startSession({
          organizationId,
          projectId,
          agentSessionId: session.id,
          conversationId: conversation.id,
          intent: {
            attachments: input.attachments ?? [],
            handlerPromptType: "verify_feature",
            payload,
            provider: input.provider,
            model,
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
            ...scope,
            initialMessage: { role: MessageType.User },
          },
        });
        if (result.state !== "succeeded" && result.state !== "accepted") {
          setError(
            result.state === "cancelled"
              ? "Verification launch was cancelled."
              : result.message,
          );
          return false;
        }
        navigate(
          paths.entityConversation({
            projectId,
            agentSessionId: session.id,
            conversationId: conversation.id,
            entityId: featureId,
            entityType: input.check.feature.entityType,
          }),
        );
        return true;
      } catch (failure) {
        setError(
          getErrorMessage(failure, "Could not start feature verification."),
        );
        return false;
      } finally {
        pending.current = false;
        setIsLoading(false);
      }
    },
    [accessResolver, navigate, paths, organizationId, projectId],
  );
  return { launch, isLoading, error, clearError };
}
