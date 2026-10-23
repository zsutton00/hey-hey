import { useCallback } from "react";
import { WorkflowName } from "../../api";
import type { UIElement } from "../../api";
import type { QuestionsSystemMessageData } from "../../api";
import { LocalPromptType } from "../../api";
import type { ProposalsAcceptedHandler } from "../Conversation/ConversationViewer";
import { FIELD_REGISTRY, getRegistryType } from "../LlmForms/Registry";
import type { AutoSubmitContext } from "../LlmForms/Registry/types";
import { logError } from "./runtime/coding/agent-session-helpers";
import {
  buildAgentInput,
  buildDirectTriggerInput,
} from "./runtime/hooks/directTriggerInput";
import { useAgentSessionInteractionAccess } from "./operations/useAgentSessionInteractionAccess";

/**
 * The canonical text posted as `userMessage` by the workflow-name fallback
 * (and the `agent-reply-textarea` registry strategy). Re-exported so tests can
 * assert on the exact value.
 */
export const AUTO_ADVANCE_MESSAGE_TEXT =
  "All proposals approved, ready for the next phase";

/**
 * Workflows that still rely on the legacy free-text auto-advance — they emit
 * messages whose uiElements have no registered `autoSubmit` strategy (no
 * uiElement at all for FeatureSync). Registry-declared strategies always take
 * precedence; this allowlist only fires when no element claims the message.
 *
 * PlanFromDesignDoc is intentionally absent: plan shaping advances exclusively
 * through registry-declared structured strategies, never free-text dispatch.
 */
const WORKFLOW_FALLBACK_ALLOWLIST: ReadonlySet<WorkflowName> = new Set([
  WorkflowName.FeatureSync,
]);

/**
 * The free-text continuation belongs to the task-anchored Feature Sync turn
 * that authored the proposals. Workflow identity alone is insufficient: the
 * same conversation can contain later SYSTEM messages from other agents.
 */
const FEATURE_SYNC_FALLBACK_PROMPT_HANDLERS: ReadonlySet<string> = new Set([
  LocalPromptType.FeatureSyncAnalyze,
  LocalPromptType.FeatureSyncIterate,
]);

export interface UseAutoAdvanceFeatureSyncIterateOptions {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string | null;
  runId: string | null;
  machineId: string | null;
  /**
   * Drives the legacy free-text fallback when no uiElement on the message
   * declares an `autoSubmit` strategy in FIELD_REGISTRY. Required for
   * FeatureSync (no uiElement) to auto-advance. PlanFromDesignDoc advances
   * only through registry-declared structured strategies and must never
   * trigger the free-text fallback.
   */
  workflowName?: WorkflowName;
}

export const useAutoAdvanceFeatureSyncIterate = ({
  organizationId,
  projectId,
  agentSessionId,
  conversationId,
  runId,
  machineId,
  workflowName,
}: UseAutoAdvanceFeatureSyncIterateOptions): ProposalsAcceptedHandler => {
  const interactionAccess = useAgentSessionInteractionAccess(machineId);
  return useCallback<ProposalsAcceptedHandler>(
    (payload) => {
      const { message, totalProposals, approvedCount, rejectedCount } = payload;

      if (!runId || !conversationId || !interactionAccess.isDeviceEnabled)
        return;

      const messageData = message.data as QuestionsSystemMessageData;
      const uiElements: UIElement[] = Array.isArray(messageData.uiElements)
        ? (messageData.uiElements as UIElement[])
        : [];

      console.log(
        "[ProposalsAccepted] useAutoAdvanceFeatureSyncIterate callback received",
        {
          messageId: message.id,
          totalProposals,
          approvedCount,
          rejectedCount,
          workflowName,
          hasActiveRun: !!runId,
          promptHandler: messageData.promptHandler,
          elementTypes: uiElements.map((e) => e.type),
        },
      );

      let registryClaimedElement = false;
      for (const element of uiElements) {
        const registryType = getRegistryType(element);
        const entry = FIELD_REGISTRY[registryType];
        if (!entry?.autoSubmit) continue;

        registryClaimedElement = true;

        const ctx: AutoSubmitContext = {
          element,
          rejectedCount,
          approvedCount,
          totalProposals,
        };

        if (!entry.autoSubmit.shouldFire(message, ctx)) continue;

        const autoPayload = entry.autoSubmit.buildPayload(message, ctx);
        if (!autoPayload) continue;

        console.log("[ProposalsAccepted] auto-advance firing (registry)", {
          messageId: message.id,
          elementType: element.type,
          handler: autoPayload.handler,
        });

        void interactionAccess.interactions
          .submitMessage(
            buildDirectTriggerInput({
              organizationId,
              projectId,
              agentSessionId,
              conversationId,
              data: autoPayload.data,
              handler: autoPayload.handler,
            }),
          )
          .then((result) => {
            if (result.state !== "succeeded" && result.state !== "accepted") {
              throw new Error(
                result.state === "cancelled"
                  ? "The operation was cancelled."
                  : result.message,
              );
            }
          })
          .catch((err: unknown) => {
            logError(
              "useAutoAdvanceFeatureSyncIterate: postMessage FAILED",
              err,
            );
          });

        return;
      }

      if (registryClaimedElement) return;
      if (!workflowName || !WORKFLOW_FALLBACK_ALLOWLIST.has(workflowName)) {
        return;
      }
      if (
        !messageData.promptHandler ||
        !FEATURE_SYNC_FALLBACK_PROMPT_HANDLERS.has(messageData.promptHandler)
      ) {
        return;
      }
      if (rejectedCount !== 0) return;
      if (approvedCount + rejectedCount !== totalProposals) return;

      console.log(
        "[ProposalsAccepted] auto-advance firing (workflow fallback)",
        {
          messageId: message.id,
          workflowName,
        },
      );

      void interactionAccess.interactions
        .submitMessage(
          buildDirectTriggerInput({
            organizationId,
            projectId,
            agentSessionId,
            conversationId,
            data: {
              agentInput: buildAgentInput({
                promptType: LocalPromptType.WorkflowDefined,
                userMessage: AUTO_ADVANCE_MESSAGE_TEXT,
              }),
              references: { resolved: [], unresolved: [] },
              attachUserMessageData: true,
              triggerMessageId: message.id,
            },
          }),
        )
        .then((result) => {
          if (result.state !== "succeeded" && result.state !== "accepted") {
            throw new Error(
              result.state === "cancelled"
                ? "The operation was cancelled."
                : result.message,
            );
          }
        })
        .catch((err: unknown) => {
          logError("useAutoAdvanceFeatureSyncIterate: postMessage FAILED", err);
        });
    },
    [
      interactionAccess,
      organizationId,
      projectId,
      agentSessionId,
      conversationId,
      runId,
      workflowName,
    ],
  );
};
