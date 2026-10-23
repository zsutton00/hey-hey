import type { SxProps, Theme } from "@mui/material";
import React, { useCallback, useMemo } from "react";
import type {
  AdrContentApplyPayloadAllOfSections,
  DesignDocDraftSection,
  SecondaryActionConfig,
} from "../../api";
import { DesignDocSectionUpdateSource as DesignDocSectionUpdateSourceEnum } from "../../api";
import { useDesignDoc } from "../../data/hooks/useDesignDoc";
import { useUpdateDesignDoc } from "../../data/hooks/useUpdateDesignDoc";
import { getCurrentLevelFromStatus } from "../../utils/adrUtils";
import { log } from "../../utils/logger";
import { SuggestedContent } from "./SuggestedContent";
import type { SuggestionDecisionStatus } from "../Conversation/hooks/useSuggestionDecisions";
import { publishSuggestionAppliedEvent } from "../../services/editorSync/suggestionAppliedBus";
import type { SecondaryActionConfigWithHandler } from "../LlmForms";

export interface DesignDocSuggestedContentProps {
  /** Secondary action configuration containing sections to display */
  secondaryAction?: SecondaryActionConfig | SecondaryActionConfigWithHandler;
  /** Optional header text (e.g., "Suggested Context") */
  title?: string;
  /** Optional icon to display in the header */
  icon?: React.ReactNode;
  /** Design document ID to update when accepting suggestions */
  designDocId?: string;
  /** Project ID for API calls */
  projectId: string;
  /** Organization ID for API calls */
  organizationId: string;
  /** Message ID to scope rejection state per message */
  messageId?: string;
  /** Enable diff rendering (default: true) */
  enableDiff?: boolean;
  /** Enable per-diff interactive accept/reject review */
  enableInteractiveDiffReview?: boolean;
  /** Optional callback when user accepts the suggestion (called after API success) */
  onAccept?: (sections: AdrContentApplyPayloadAllOfSections[]) => void;
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
 * DesignDocSuggestedContent component wraps SuggestedContent and routes
 * accepted sections through the design doc update mutation.
 */
export const DesignDocSuggestedContent: React.FC<
  DesignDocSuggestedContentProps
> = ({
  secondaryAction,
  title,
  icon,
  designDocId,
  projectId,
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
  const { mutate: updateDesignDoc } = useUpdateDesignDoc();

  // Fetch design doc to get current status for section filtering
  const { data: designDoc } = useDesignDoc(organizationId, designDocId, {
    enabled: !!designDocId,
  });

  // Compute current section from design doc status
  const currentSection = useMemo(() => {
    return designDoc?.status
      ? getCurrentLevelFromStatus(designDoc.status)
      : undefined;
  }, [designDoc?.status]);

  // Create getCurrentContent function for diff rendering
  const getCurrentContent = useCallback(
    (sectionKey: string): string => {
      const normalizedKey = sectionKey.toLowerCase();
      const matchingSection = designDoc?.sections?.find(
        (section) => section.key.toLowerCase() === normalizedKey
      );
      return matchingSection?.materializedMarkdown ?? "";
    },
    [designDoc?.sections]
  );

  const handleAccept = useCallback(
    async (
      sections: AdrContentApplyPayloadAllOfSections[]
    ): Promise<boolean> => {
      if (!sections || sections.length === 0) {
        return true;
      }

      if (!designDocId) {
        log.error("ui", "Missing design doc ID for suggested content accept", {
          organizationId,
          projectId,
          sectionKeys: sections.map((section) => section.key),
        });
        return false;
      }

      try {
        const draftSections: DesignDocDraftSection[] = sections.map(
          (section, index) => {
            const existingOrder = designDoc?.sections?.find(
              (currentSection) => currentSection.key === section.key
            )?.order;
            return {
              key: section.key,
              content: section.content,
              order: existingOrder ?? index,
            };
          }
        );

        await updateDesignDoc({
          organizationId,
          designDocId,
          updates: {
            sectionUpdateSource:
              DesignDocSectionUpdateSourceEnum.AgentSuggested,
            sections: draftSections,
          },
        });

        log.info("ui", "Applied suggested sections via design doc update", {
          organizationId,
          projectId,
          designDocId,
          sectionKeys: sections.map((section) => section.key),
        });
        publishSuggestionAppliedEvent({
          target: "design-doc",
          designDocId,
          sections: sections.map((section) => ({
            key: section.key,
            content: section.content,
          })),
        });

        onAccept?.(sections);
        return true;
      } catch (error) {
        log.error("ui", "Failed to apply suggested sections via update", {
          organizationId,
          projectId,
          designDocId,
          sectionKeys: sections.map((section) => section.key),
          error: error instanceof Error ? error.message : error,
        });
        return false;
      }
    },
    [
      designDoc?.sections,
      designDocId,
      onAccept,
      organizationId,
      projectId,
      updateDesignDoc,
    ]
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
