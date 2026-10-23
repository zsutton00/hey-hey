import { useWorkItemUpdateMethods } from "../../data";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import type { SxProps, Theme } from "@mui/material";
import React, { useCallback, useMemo } from "react";
import type {
  SecondaryActionConfig,
  TaskResponseDto,
  UpdateTaskDto,
} from "../../api";
import { TaskSectionUpdateSource as TaskSectionUpdateSourceEnum } from "../../api";
import { log } from "../../utils/logger";
import { getCurrentLevelFromStatus } from "../../utils/workItemUtils";
import {
  getTaskSectionContent,
  getSelectedSectionKeys,
  selectWorkItemSections,
} from "../../utils/workItemSections";
import { SuggestedContent, type ContentItem } from "./SuggestedContent";
import type { SuggestionDecisionStatus } from "../Conversation/hooks/useSuggestionDecisions";
import { publishSuggestionAppliedEvent } from "../../services/editorSync/suggestionAppliedBus";
import type { SecondaryActionConfigWithHandler } from "../LlmForms";

export interface TaskSuggestedContentProps {
  /** Secondary action configuration containing fields to display */
  secondaryAction?: SecondaryActionConfig | SecondaryActionConfigWithHandler;
  /** Optional header text (e.g., "Suggested Content") */
  title?: string;
  /** Optional icon to display in the header */
  icon?: React.ReactNode;
  /** Task ID to update when accepting suggestions */
  taskId?: string;
  /** Organization ID for API calls */
  organizationId: string;
  /** Project ID for data hook */
  projectId: string;
  /** Message ID to scope rejection state per message */
  messageId?: string;
  /** Enable diff rendering (default: true) */
  enableDiff?: boolean;
  /** Enable per-diff interactive accept/reject review */
  enableInteractiveDiffReview?: boolean;
  /** Optional callback when user accepts the suggestion (called after API success) */
  onAccept?: (fields: readonly SuggestedTaskSectionField[]) => void;
  /** Optional callback when user rejects the suggestion */
  onReject?: () => void;
  /** Callback when user makes a decision (accept/reject) */
  onDecision?: (accepted: boolean) => void;
  /** Decision state for this suggestion */
  suggestionDecision?: SuggestionDecisionStatus;
  /** Additional styling */
  sx?: SxProps<Theme>;
}

interface SuggestedTaskSectionField {
  key: string;
  content: string;
}

/**
 * TaskSuggestedContent component wraps SuggestedContent and routes
 * accepted fields through the work item update hook for tasks.
 *
 * Maps task fields from the AI suggestion to UpdateTaskDto:
 * - description/acceptanceCriteria → updates.sections
 */
export const TaskSuggestedContent: React.FC<TaskSuggestedContentProps> = ({
  secondaryAction,
  title,
  icon,
  taskId,
  organizationId,
  projectId,
  messageId,
  enableDiff,
  enableInteractiveDiffReview,
  onAccept,
  onReject,
  onDecision,
  suggestionDecision,
  sx,
}) => {
  const { workItem } = useWorkItem(organizationId, "task", taskId!, {
    enabled: Boolean(taskId),
    projectId,
  });
  const currentTask = useMemo<TaskResponseDto | null>(
    () => workItem as TaskResponseDto | null,
    [workItem],
  );

  const { updateTask } = useWorkItemUpdateMethods(
    organizationId,
    "task",
    projectId,
  );
  const { workItemTypeDefinition, isFetched: isWorkItemTypeFetched } =
    useWorkItemTypeByKey(organizationId, projectId, currentTask?.type);
  const sectionSelection = useMemo(
    () =>
      selectWorkItemSections({
        typeKey: currentTask?.type,
        definition: workItemTypeDefinition,
        isFetched: isWorkItemTypeFetched,
      }),
    [currentTask?.type, isWorkItemTypeFetched, workItemTypeDefinition],
  );

  // Compute current section from task status
  const currentSection = useMemo(() => {
    return currentTask?.status
      ? getCurrentLevelFromStatus(currentTask.status, {
          entityType: "task",
          sectionSelection,
        })
      : undefined;
  }, [currentTask?.status, sectionSelection]);

  const taskSectionKeys = useMemo(
    () => getSelectedSectionKeys(sectionSelection),
    [sectionSelection],
  );

  const taskSectionKeySet = useMemo(
    () => new Set(taskSectionKeys),
    [taskSectionKeys],
  );

  const getCurrentContent = useCallback(
    (fieldKey: string): string => {
      if (!currentTask) {
        return "";
      }

      if (taskSectionKeySet.has(fieldKey)) {
        return getTaskSectionContent(currentTask.sections, fieldKey);
      }

      log.warn("ui", "Unknown task field key for diff", {
        fieldKey,
        organizationId,
        taskId,
      });
      return "";
    },
    [currentTask, organizationId, taskId, taskSectionKeySet],
  );

  const handleAccept = useCallback(
    async (items: ContentItem[]): Promise<boolean> => {
      if (!items || items.length === 0) {
        return true;
      }

      if (!taskId) {
        log.error("ui", "Missing task ID for task suggestion", {
          organizationId,
          taskId,
          itemKeys: items.map((item) => item.key),
        });
        return false;
      }

      if (sectionSelection.status !== "resolved") {
        log.warn(
          "ui",
          "Cannot apply task suggestion without a resolved type definition",
          {
            organizationId,
            taskId,
            reason: sectionSelection.reason,
          },
        );
        return false;
      }

      const fields: SuggestedTaskSectionField[] = items.map((item) => ({
        key: item.key,
        content: item.content,
      }));

      try {
        const sectionFields = fields.filter((field) =>
          taskSectionKeySet.has(field.key),
        );

        const updates: UpdateTaskDto = {
          sectionUpdateSource: TaskSectionUpdateSourceEnum.AgentSuggested,
          sections: sectionFields.map((field) => ({
            key: field.key,
            content: field.content,
            order: taskSectionKeys.indexOf(field.key),
          })),
        };

        if (!updates.sections?.length) {
          return false;
        }

        await updateTask(taskId, updates, {
          sectionSelection,
          onSuccess: () => {
            log.info("ui", "Applied suggested fields to task", {
              organizationId,
              taskId,
              fieldKeys: fields.map((f) => f.key),
            });
            publishSuggestionAppliedEvent({
              target: "work-item",
              entityType: "task",
              workItemId: taskId,
              sections: sectionFields.map((field) => ({
                key: field.key,
                content: field.content,
              })),
            });

            onAccept?.(fields);
          },
          onError: (error) => {
            log.error("ui", "Failed to apply suggested fields to task", {
              organizationId,
              taskId,
              error: error instanceof Error ? error.message : error,
            });
          },
        });
        return true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : error;
        log.error("ui", "Unexpected error applying suggestions to task", {
          organizationId,
          taskId,
          error: errorMessage,
        });
        return false;
      }
    },
    [
      onAccept,
      organizationId,
      sectionSelection,
      taskId,
      taskSectionKeys,
      taskSectionKeySet,
      updateTask,
    ],
  );

  return (
    <SuggestedContent
      secondaryAction={secondaryAction}
      title={title}
      icon={icon}
      onAccept={handleAccept}
      onReject={onReject}
      onDecision={onDecision}
      suggestionDecision={suggestionDecision}
      messageId={messageId}
      getCurrentContent={getCurrentContent}
      enableDiff={enableDiff}
      enableInteractiveDiffReview={enableInteractiveDiffReview}
      currentSection={currentSection}
      sx={sx}
    />
  );
};
