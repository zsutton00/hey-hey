import type { SxProps, Theme } from "@mui/material";
import React, { useCallback, useMemo } from "react";
import type {
  InitiativeContentApplyPayloadAllOfFields,
  SecondaryActionConfig,
  UpdateInitiativeDto,
} from "../../api";
import { InitiativeSectionUpdateSource as InitiativeSectionUpdateSourceEnum } from "../../api";
import { useInitiative } from "../../data/hooks";
import { getCurrentLevelFromStatus } from "../../utils/initiativeUtils";
import { log } from "../../utils/logger";
import {
  WORK_ITEM_SECTION_KEYS,
  getWorkItemSectionContent,
  type WorkItemSectionKey,
} from "../../utils/workItemSections";
import { SuggestedContent, type ContentItem } from "./SuggestedContent";
import type { SuggestionDecisionStatus } from "../Conversation/hooks/useSuggestionDecisions";
import { publishSuggestionAppliedEvent } from "../../services/editorSync/suggestionAppliedBus";
import type { SecondaryActionConfigWithHandler } from "../LlmForms";

export interface InitiativeSuggestedContentProps {
  /** Secondary action configuration containing fields to display */
  secondaryAction?: SecondaryActionConfig | SecondaryActionConfigWithHandler;
  /** Optional header text (e.g., "Suggested Content") */
  title?: string;
  /** Optional icon to display in the header */
  icon?: React.ReactNode;
  /** Initiative ID to update when accepting suggestions */
  initiativeId?: string;
  /** Organization ID for API calls */
  organizationId: string;
  /** Project ID for data hook */
  projectId?: string;
  /** Message ID to scope rejection state per message */
  messageId?: string;
  /** Enable diff rendering (default: true) */
  enableDiff?: boolean;
  /** Enable per-diff interactive accept/reject review */
  enableInteractiveDiffReview?: boolean;
  /** Optional callback when user accepts the suggestion (called after API success) */
  onAccept?: (fields: InitiativeContentApplyPayloadAllOfFields[]) => void;
  /** Optional callback when user rejects the suggestion */
  onReject?: () => void;
  /** Callback when user makes a decision (accept/reject) */
  onDecision?: (accepted: boolean) => void;
  /** Decision state for this suggestion */
  suggestionDecision?: SuggestionDecisionStatus;
  /** Additional styling */
  sx?: SxProps<Theme>;
}

/**
 * InitiativeSuggestedContent component wraps SuggestedContent and routes
 * accepted fields through the initiative update hook.
 *
 * Maps initiative fields from the AI suggestion to UpdateInitiativeDto:
 * - description/details/acceptanceCriteria → updates.sections
 */
export const InitiativeSuggestedContent: React.FC<
  InitiativeSuggestedContentProps
> = ({
  secondaryAction,
  title,
  icon,
  initiativeId,
  organizationId,
  messageId,
  enableDiff,
  enableInteractiveDiffReview,
  onAccept,
  onReject,
  onDecision,
  suggestionDecision,
  sx,
}) => {
  const { update, data: currentInitiative } = useInitiative(
    organizationId,
    initiativeId as string,
    {
      enabled: !!initiativeId,
    }
  );

  // Compute current section from initiative status
  const currentSection = useMemo(() => {
    return currentInitiative?.status
      ? getCurrentLevelFromStatus(currentInitiative.status)
      : undefined;
  }, [currentInitiative?.status]);

  // Create getCurrentContent function for diff rendering
  const getCurrentContent = useCallback(
    (fieldKey: string): string => {
      if (!currentInitiative) {
        return "";
      }

      if (fieldKey === "description" || fieldKey === "acceptanceCriteria") {
        return getWorkItemSectionContent(currentInitiative.sections, fieldKey);
      }

      log.warn("ui", "Unknown initiative field key for diff", {
        fieldKey,
        organizationId,
        initiativeId,
      });
      return "";
    },
    [currentInitiative, organizationId, initiativeId]
  );

  const handleAccept = useCallback(
    async (items: ContentItem[]): Promise<boolean> => {
      if (!items || items.length === 0) {
        return true;
      }

      if (!initiativeId) {
        log.error("ui", "No initiative ID provided for suggestions", {
          organizationId,
          itemKeys: items.map((item) => item.key),
        });
        return false;
      }

      // Cast items to InitiativeContentApplyPayloadAllOfFields
      const fields = items as InitiativeContentApplyPayloadAllOfFields[];

      try {
        const sectionFields = fields.filter(
          (
            field
          ): field is InitiativeContentApplyPayloadAllOfFields & {
            key: WorkItemSectionKey;
          } =>
            field.key === "description" ||
            field.key === "details" ||
            field.key === "acceptanceCriteria"
        );

        const updates: UpdateInitiativeDto = {
          sectionUpdateSource: InitiativeSectionUpdateSourceEnum.AgentSuggested,
          sections: sectionFields.map((field) => ({
            key: field.key,
            content: field.content,
            order: WORK_ITEM_SECTION_KEYS.indexOf(field.key),
          })),
        };

        if (!updates.sections?.length) {
          return true;
        }

        // Apply updates via the initiative hook
        await update(updates, {
          onSuccess: () => {
            log.info("ui", "Applied suggested fields to initiative", {
              organizationId,
              initiativeId,
              fieldKeys: fields.map((f) => f.key),
            });
            publishSuggestionAppliedEvent({
              target: "work-item",
              entityType: "initiative",
              workItemId: initiativeId,
              sections: sectionFields.map((field) => ({
                key: field.key,
                content: field.content,
              })),
            });

            if (onAccept) {
              onAccept(fields);
            }
          },
          onError: (error) => {
            log.error("ui", "Failed to apply suggested fields to initiative", {
              organizationId,
              initiativeId,
              error: error instanceof Error ? error.message : error,
            });
          },
        });
        return true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : error;
        log.error("ui", "Unexpected error applying suggestions to initiative", {
          organizationId,
          initiativeId,
          error: errorMessage,
        });
        return false;
      }
    },
    [update, initiativeId, onAccept, organizationId]
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
