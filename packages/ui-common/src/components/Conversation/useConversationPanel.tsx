import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ExpandIcon from "@mui/icons-material/UnfoldMore";
import CollapseIcon from "@mui/icons-material/UnfoldLess";
import type { ToolbarButton } from "./ConversationToolbar";

export interface UseConversationPanelOptions {
  /** Initial expanded state (defaults to false) */
  initialExpanded?: boolean;
  /** Additional toolbar buttons to include (e.g., Help button) */
  additionalButtons?: ToolbarButton[];
}

export interface UseConversationPanelReturn {
  /** Whether the conversation panel is expanded */
  isExpanded: boolean;
  /** Handler to toggle the expanded state */
  toggleExpanded: () => void;
  /** Toolbar buttons including expand/collapse and any additional buttons */
  toolbarButtons: ToolbarButton[];
}

/**
 * Custom hook for managing conversation panel expand/collapse state and toolbar buttons
 *
 * @example
 * ```tsx
 * const { isExpanded, toolbarButtons } = useConversationPanel({
 *   additionalButtons: [helpButton],
 * });
 * ```
 */
export const useConversationPanel = (
  options: UseConversationPanelOptions = {}
): UseConversationPanelReturn => {
  const { initialExpanded = false, additionalButtons = [] } = options;
  const { t } = useTranslation();

  // Manage expand/collapse state
  const [isExpanded, setIsExpanded] = useState<boolean>(initialExpanded);

  // Toggle handler
  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  // Create toolbar buttons array
  const toolbarButtons = useMemo<ToolbarButton[]>(() => {
    const buttons: ToolbarButton[] = [...additionalButtons];

    // Add expand/collapse button
    buttons.push({
      key: "expand-collapse",
      label: isExpanded
        ? t("conversation.collapse", "Collapse conversation")
        : t("conversation.expand", "Expand conversation"),
      icon: isExpanded ? (
        <CollapseIcon style={{ transform: "rotate(90deg)" }} />
      ) : (
        <ExpandIcon style={{ transform: "rotate(90deg)" }} />
      ),
      onClick: toggleExpanded,
      tooltip: isExpanded
        ? t("conversation.collapse", "Collapse conversation")
        : t("conversation.expand", "Expand conversation"),
    });

    return buttons;
  }, [additionalButtons, isExpanded, toggleExpanded, t]);

  return {
    isExpanded,
    toggleExpanded,
    toolbarButtons,
  };
};
