import type { PlanConfigurationV1 } from "../../api";
import { Alert, LinearProgress } from "@mui/material";
import React from "react";
import type { AgentSessionDto, TaskResponseDto } from "../../api";
import { usePlanFromDesignDocConversation } from "../../data/hooks/usePlanFromDesignDocConversation";
import {
  DISABLED_CONVERSATION_SCROLL_POLICY,
  type ConversationScrollPolicy,
} from "../Conversation/ConversationViewer";
import { PlanFromDesignDocChat } from "./PlanFromDesignDocChat";
import { PlanGenerationSetup } from "./PlanGenerationSetup";
import type { PlanGenerationLaunchHandoff } from "./usePlanGenerationDraft";

export interface PlanGenerationChatProps {
  organizationId: string;
  projectId: string;
  planId: string;
  plan: Pick<TaskResponseDto, "id" | "name" | "status">;
  configuration: PlanConfigurationV1;
  scrollPolicy?: ConversationScrollPolicy;
  onSessionReady?: (session: AgentSessionDto) => void;
  resetLaunchHandoff?: {
    conversationId: string;
    agentSessionId: string;
  };
}

/**
 * Resolves the plan-from-design-doc conversation for a plan and hands it to
 * {@link PlanFromDesignDocChat}, regardless of whether it has started yet. The
 * conversation is materialized server-side at `create_plan` approval or by
 * explicit setup on a draft without a session. The
 * kickoff is user-driven from the pre-start placeholder (which renders the
 * seed design doc and a "Start generating" button), so a NotStarted
 * conversation routes straight into that placeholder path rather than being
 * auto-started here.
 */
export const PlanGenerationChat: React.FC<PlanGenerationChatProps> = ({
  organizationId,
  projectId,
  planId,
  plan,
  configuration,
  scrollPolicy = DISABLED_CONVERSATION_SCROLL_POLICY,
  onSessionReady,
  resetLaunchHandoff,
}) => {
  const {
    conversation: planFromDesignDocConversation,
    isFetched: isPlanFromDesignDocFetched,
    error,
    markStale,
  } = usePlanFromDesignDocConversation(organizationId, projectId, planId, {
    enabled: !!organizationId && !!projectId && !!planId,
  });

  const [preparingPlanId, setPreparingPlanId] = React.useState<string | null>(
    null
  );
  const [draftLaunchState, setDraftLaunch] = React.useState<{
    planId: string;
    handoff: PlanGenerationLaunchHandoff;
  } | null>(null);
  const preparing = preparingPlanId === planId;
  const draftLaunch =
    draftLaunchState?.planId === planId ? draftLaunchState.handoff : null;
  const launchHandoff = draftLaunch ?? resetLaunchHandoff;
  const hasMatchingResetConversation =
    !launchHandoff ||
    planFromDesignDocConversation?.id === launchHandoff.conversationId;

  if (error)
    return (
      <Alert severity="error" data-testid="plan-generation-error">
        {error.message}
      </Alert>
    );

  if (!isPlanFromDesignDocFetched || !hasMatchingResetConversation) {
    return <LinearProgress />;
  }

  if (!planFromDesignDocConversation || preparing) {
    return (
      <PlanGenerationSetup
        key={planId}
        organizationId={organizationId}
        projectId={projectId}
        planId={planId}
        planName={plan.name}
        configuration={configuration}
        onPreparingChange={(pending) =>
          setPreparingPlanId(pending ? planId : null)
        }
        onPrepared={(handoff) => {
          setDraftLaunch({ planId, handoff });
          markStale();
        }}
      />
    );
  }

  return (
    <PlanFromDesignDocChat
      key={planFromDesignDocConversation.id}
      organizationId={organizationId}
      projectId={projectId}
      planId={planId}
      plan={plan}
      configuration={configuration}
      conversation={planFromDesignDocConversation}
      onGenerationReset={() => {
        setDraftLaunch(null);
        markStale();
      }}
      onSessionReady={onSessionReady}
      autoStartAgentSessionId={launchHandoff?.agentSessionId}
      launchSettings={draftLaunch?.settings}
      scrollPolicy={scrollPolicy}
    />
  );
};
