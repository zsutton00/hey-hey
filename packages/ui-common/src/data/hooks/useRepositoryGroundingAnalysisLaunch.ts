import { useCallback } from "react";
import type {
  AgentSessionConfigV2,
  AgentSessionDto,
  CreateAgentSessionConversationDto,
  RepositoryImportReplyAnswers,
} from "../../api";
import {
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  AgentSessionType,
  RepositoryGroundingAction,
  WorkflowName,
} from "../../api";
import { conversationsClient } from "../../clients/serviceClients";
import { fingerprintAgentOperation } from "../../components/AgentSession/operations/agentOperationFingerprint";
import { useAgentSessionInteractionAccessResolver } from "../../components/AgentSession/operations/useAgentSessionInteractionAccess";
import { projectRepositoryImportReviewAnswers } from "../../components/Conversation/utils/onboardingReviewSubmission";
import { bindGraphConversationAgentSessionMachine } from "../../components/InteractionComponent/bindGraphConversationAgentSessionMachine";
import type { RepositoryGroundingSubmission } from "../../components/LlmForms/Registry/repositoryGroundingUtils";
import { submitControllerAuthorizedWorkflowAnswer } from "./submitControllerAuthorizedWorkflowAnswer";
import { useCreateAgentSession } from "./useCreateAgentSession";
import { useCreateAgentSessionConversation } from "./useCreateAgentSessionConversation";

export interface RepositoryGroundingAnalysisLaunchInput {
  organizationId: string;
  projectId: string;
  conversationId: string;
  workflowId: string;
  nodeId: string;
  parentMessageId: string;
  submission: RepositoryGroundingSubmission;
}

const projectLaunchAnswers = (
  submission: RepositoryGroundingSubmission,
): RepositoryImportReplyAnswers =>
  projectRepositoryImportReviewAnswers({ repository_grounding: submission });

const workflowOperationIds = new Map<string, string>();
const activeLaunches = new Map<string, Promise<AgentSessionDto>>();

const requireSameRepositoryImportConversation = async (input: {
  organizationId: string;
  projectId: string;
  expectedConversationId: string;
  conversation: {
    id: string;
    workflowId?: string;
    workflowName: WorkflowName;
    workflowAboutType?: string;
    workflowAboutId?: string;
  };
}): Promise<void> => {
  const { conversation } = input;
  const isDedicatedImport =
    conversation.workflowName === WorkflowName.RepositoryImport;
  const isLegacyImport = conversation.workflowName === WorkflowName.Onboarding;
  if (
    conversation.id !== input.expectedConversationId ||
    (!isDedicatedImport && !isLegacyImport) ||
    !conversation.workflowAboutType ||
    !conversation.workflowAboutId
  ) {
    throw new Error(
      "The Agent Session did not return the active repository import Conversation.",
    );
  }
  const response = await conversationsClient.getWorkflowConversations({
    organizationId: input.organizationId,
    projectId: input.projectId,
    workflowName: conversation.workflowAboutType,
    workflowAboutId: conversation.workflowAboutId,
    workflowName2: conversation.workflowName,
  });
  const conversations = response.data?.data?.data ?? [];
  const resolved = conversations.find(
    (candidate) => candidate.id === input.expectedConversationId,
  );
  if (
    !resolved ||
    resolved.workflowId !== conversation.workflowId ||
    resolved.workflowName !== conversation.workflowName
  ) {
    throw new Error(
      "The active repository import Conversation could not be verified for this Agent Session.",
    );
  }
};

export function useRepositoryGroundingAnalysisLaunch() {
  const { mutate: createAgentSession } = useCreateAgentSession();
  const { mutate: createAgentSessionConversation } =
    useCreateAgentSessionConversation();
  const interactionAccessResolver = useAgentSessionInteractionAccessResolver();

  const launchRepositoryGroundingAnalysis = useCallback(
    async (
      input: RepositoryGroundingAnalysisLaunchInput,
    ): Promise<AgentSessionDto> => {
      const answers = projectLaunchAnswers(input.submission);
      const prerequisites = answers.repository_prerequisites;
      const configuration = answers.repository_analysis_configuration;
      const action = answers.repository_grounding_action;
      if (!prerequisites || !configuration || !action) {
        throw new Error(
          "Repository analysis requires the complete saved launch selection.",
        );
      }
      if (
        action !== RepositoryGroundingAction.StartAnalysis &&
        action !== RepositoryGroundingAction.RetryAnalysis
      ) {
        throw new Error(
          "Repository analysis launch only accepts start or retry actions.",
        );
      }

      const launchFingerprint = await fingerprintAgentOperation({
        kind: "REPOSITORY_IMPORT_WORKFLOW_ANALYSIS",
        organizationId: input.organizationId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        answers,
      });
      const joined = activeLaunches.get(launchFingerprint);
      if (joined) return joined;

      const operationId =
        workflowOperationIds.get(launchFingerprint) ?? crypto.randomUUID();
      workflowOperationIds.set(launchFingerprint, operationId);
      const launch = (async (): Promise<AgentSessionDto> => {
        const runtimeConfig = {
          type: AgentSessionConfigV2TypeEnum.CodingSession,
          version: AgentSessionConfigV2VersionEnum.V2,
          model: configuration.resolvedFrontierModel,
          effort: configuration.reasoningEffort,
          ...(configuration.fastMode === undefined
            ? {}
            : { fastMode: configuration.fastMode }),
        } satisfies AgentSessionConfigV2;
        const session = await createAgentSession({
          organizationId: input.organizationId,
          agentSession: {
            projectId: input.projectId,
            sessionDate: new Date().toISOString(),
            title: "Repository analysis",
            type: AgentSessionType.Coding,
            serviceIds: [prerequisites.serviceId],
            launchServiceId: prerequisites.serviceId,
            provider: configuration.provider,
            config: runtimeConfig,
            existingWorkflowBinding: {
              conversationId: input.conversationId,
              workflowId: input.workflowId,
            },
          },
        });
        const boundSession = await bindGraphConversationAgentSessionMachine({
          organizationId: input.organizationId,
          projectId: input.projectId,
          agentSessionId: session.id,
          machineId: prerequisites.machineId,
        });
        const attached = await createAgentSessionConversation({
          organizationId: input.organizationId,
          projectId: input.projectId,
          agentSessionId: session.id,
          body: {
            workflowType: WorkflowName.RepositoryImport,
            workflowAboutType: "project",
            workflowAboutId: input.projectId,
          } satisfies CreateAgentSessionConversationDto,
        });
        if (
          attached.agentSession.id !== session.id ||
          attached.agentSession.conversationId !== input.conversationId ||
          boundSession.id !== session.id ||
          boundSession.machineId !== prerequisites.machineId
        ) {
          throw new Error(
            "The Agent Session launch bindings did not match the saved repository import selection.",
          );
        }
        await requireSameRepositoryImportConversation({
          organizationId: input.organizationId,
          projectId: input.projectId,
          expectedConversationId: input.conversationId,
          conversation: attached.conversation,
        });

        const access = interactionAccessResolver.getAccess(
          prerequisites.machineId,
        );
        if (!access.isDeviceEnabled) {
          throw new Error(access.unavailable.message);
        }
        const readiness = await access.interactions.startSession({
          organizationId: input.organizationId,
          projectId: input.projectId,
          agentSessionId: session.id,
          conversationId: input.conversationId,
          intent: {
            workflowName: WorkflowName.RepositoryImport,
            model: configuration.resolvedFrontierModel,
            reasoningEffort: configuration.reasoningEffort,
            provider: configuration.provider,
            config: runtimeConfig,
            ...(configuration.fastMode === undefined
              ? {}
              : { fastMode: configuration.fastMode }),
            contextMetadata: {
              capturedAt: new Date().toISOString(),
              organizationId: input.organizationId,
              projectId: input.projectId,
              agentSessionId: session.id,
              userComments: [],
              fileReferences: { resolved: [], unresolved: [] },
            },
            serviceIds: [prerequisites.serviceId],
            launchServiceId: prerequisites.serviceId,
          },
        });
        if (readiness.state !== "succeeded" && readiness.state !== "accepted") {
          throw new Error(
            readiness.state === "cancelled"
              ? "Repository analysis authorization was cancelled."
              : readiness.message,
          );
        }

        await submitControllerAuthorizedWorkflowAnswer({
          operationId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          agentSessionId: session.id,
          conversationId: input.conversationId,
          workflowName: WorkflowName.RepositoryImport,
          nodeId: input.nodeId,
          parentMessageId: input.parentMessageId,
          action,
          payload: { ...answers },
        });
        return session;
      })();
      activeLaunches.set(launchFingerprint, launch);
      try {
        return await launch;
      } finally {
        activeLaunches.delete(launchFingerprint);
      }
    },
    [
      createAgentSession,
      createAgentSessionConversation,
      interactionAccessResolver,
    ],
  );

  return { launchRepositoryGroundingAnalysis };
}
