import { useCallback } from "react";
import { SubmitTaskMonitorCommandResponseDtoStatusEnum } from "../../api";
import { useSubmitTaskMonitorCommand } from "../../data/hooks";
import type { ConversationFormResolver } from "../Conversation/Components/conversationFormTypes";
import {
  buildTaskMonitorJudgmentCommand,
  getTaskMonitorJudgmentFormUiElements,
  isAwaitingTaskMonitorJudgment,
  resolveTaskMonitorJudgmentTarget,
} from "./taskMonitorJudgmentForm";

export interface UseTaskMonitorConversationFormResolverOptions {
  organizationId: string;
  projectId: string;
  monitorId: string;
  selectedMachineId: string | null;
}

export const useTaskMonitorConversationFormResolver = ({
  organizationId,
  projectId,
  monitorId,
  selectedMachineId,
}: UseTaskMonitorConversationFormResolverOptions): ConversationFormResolver => {
  const { mutate, isPending } = useSubmitTaskMonitorCommand();

  return useCallback<ConversationFormResolver>(
    (conversationMessage) => {
      if (!isAwaitingTaskMonitorJudgment(conversationMessage.message)) {
        return null;
      }

      const commandTarget = resolveTaskMonitorJudgmentTarget(monitorId);
      const isSubmitted = !conversationMessage.canEdit;
      const isCommandUnavailable =
        commandTarget === null || selectedMachineId === null;

      const uiElements = getTaskMonitorJudgmentFormUiElements(conversationMessage.message);
      return {
        responseDeclarations: uiElements.map((element) => ({
          ownership: "exclusive",
          currentFieldId: element.id,
          submissionKind: "owner-command",
        })),
        uiElements,
        disabled: isCommandUnavailable || isSubmitted || isPending,
        isSubmitted,
        composerResetMode: "clearOnSuccess",
        submit: async (data) => {
          if (!commandTarget) {
            throw new Error(
              "The Task Monitor command target is missing from this conversation."
            );
          }
          if (!selectedMachineId) {
            throw new Error(
              "A controller-ready selected machine is required for this Task Monitor command."
            );
          }

          const outcome = await mutate({
            organizationId,
            projectId,
            monitorId: commandTarget,
            request: {
              requestId: conversationMessage.message.id,
              machineId: selectedMachineId,
              command: buildTaskMonitorJudgmentCommand(
                conversationMessage.message.id,
                data
              ),
            },
          });
          if (
            outcome.status ===
            SubmitTaskMonitorCommandResponseDtoStatusEnum.Rejected
          ) {
            throw new Error(
              outcome.message ?? "The Task Monitor rejected the judgment."
            );
          }
        },
      };
    },
    [monitorId, organizationId, projectId, selectedMachineId, isPending, mutate]
  );
};
