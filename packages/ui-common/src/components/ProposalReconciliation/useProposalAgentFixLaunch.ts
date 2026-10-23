import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  ProposalAgentFixRequest,
  ProposalResponseDto,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { reconcileAcceptedAgentLaunch } from "../../data/agentLaunchReconciliation";
import { getErrorMessage } from "../../utils/errorUtils";
import { supportsFastMode } from "../AgentSession/capabilityCatalog";
import { useAgentSessionInteractionAccessResolver } from "../AgentSession/operations/useAgentSessionInteractionAccess";

export interface AgentFixLaunchSelection {
  machineId: string;
  provider: ConversationStartRunRequestDtoProviderEnum;
  model: string;
  reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum;
  fastMode?: boolean;
}

/**
 * Agent fix through Agentic Processes: the API records the request (session,
 * conversation and run input) and the app starts it with the user's machine
 * and authorization, carrying the recorded input unchanged. Every attempt,
 * including a retry, re-records first, which returns the same unstarted
 * session, so a retry starts against the same record with one stable
 * operation id per session.
 */
export function useProposalAgentFixLaunch() {
  const accessResolver = useAgentSessionInteractionAccessResolver();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const operationIds = useRef(new Map<string, string>());
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = useCallback(
    async (
      proposal: ProposalResponseDto,
      selection: AgentFixLaunchSelection,
    ): Promise<ProposalAgentFixRequest | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setIsPending(true);
      setError(null);
      try {
        const access = accessResolver.getAccess(selection.machineId);
        if (!access.isDeviceEnabled)
          throw new Error(access.unavailable.message);
        const request = (
          await proposalsClient.createProposalAgentFixRequest({
            organizationId: proposal.organizationId,
            projectId: proposal.projectId,
            proposalId: proposal.id,
          })
        ).data.data;
        const operationId =
          operationIds.current.get(request.agentSessionId) ??
          crypto.randomUUID();
        operationIds.current.set(request.agentSessionId, operationId);
        const fastMode =
          supportsFastMode(selection.provider, selection.model) &&
          selection.fastMode !== undefined
            ? { fastMode: selection.fastMode }
            : {};
        const result = await access.interactions.startSession({
          operationId,
          organizationId: request.organizationId,
          projectId: request.projectId,
          agentSessionId: request.agentSessionId,
          conversationId: request.conversationId,
          intent: {
            attachments: [],
            handlerPromptType: "proposal_refiner",
            payload: request.payload,
            provider: selection.provider,
            model: selection.model,
            reasoningEffort: selection.reasoningEffort,
            ...fastMode,
            contextMetadata: {
              capturedAt: request.createdAt,
              userComments: [],
              fileReferences: { resolved: [], unresolved: [] },
              organizationId: request.organizationId,
              projectId: request.projectId,
              agentSessionId: request.agentSessionId,
            },
          },
        });
        if (result.state !== "accepted" && result.state !== "succeeded") {
          throw new Error(
            result.state === "cancelled"
              ? "Agent fix launch was cancelled."
              : result.message,
          );
        }
        reconcileAcceptedAgentLaunch(queryClient, {
          organizationId: request.organizationId,
          projectId: request.projectId,
          agentSessionId: request.agentSessionId,
          conversationId: request.conversationId,
        });
        return request;
      } catch (caught) {
        setError(
          getErrorMessage(caught, "The agent session could not be started."),
        );
        return null;
      } finally {
        inFlight.current = false;
        setIsPending(false);
      }
    },
    [accessResolver, queryClient],
  );

  return { launch, isPending, error };
}
