/**
 * Hook for complete task generation CapsuleAction integration
 *
 * Provides a turnkey hook that returns everything needed for CapsuleAction registration.
 * Combines menu items, conversation status, and render callback.
 */

import React, { useCallback } from "react";
import { useConversation } from "../../../data/hooks/useConversation";
import { useTaskGenerationMenuItems } from "./useTaskGenerationMenuItems";
import type { TaskGenerationContentProps } from "./TaskGenerationContent";
import { TaskGenerationContent } from "./TaskGenerationContent";
import type { CapsuleActionMenuItem } from "../types";
import type { Stable } from "../../../types";

/**
 * Props for useTaskGenerationCapsuleAction hook
 */
export interface UseTaskGenerationCapsuleActionProps
  extends TaskGenerationContentProps {
  /** Custom action ID (default: "tasks-generation") */
  actionId?: string;
  /** Custom label (default: "Tasks") */
  label?: string;
  /** Custom title (default: "Task Generation") */
  title?: string;
}

/**
 * Return type for useTaskGenerationCapsuleAction hook
 */
export interface UseTaskGenerationCapsuleActionResult {
  behavior: "expand";
  actionId: string;
  label: string;
  title: string;
  menuItems: CapsuleActionMenuItem[];
  renderContent: Stable<() => React.ReactNode>;
  inProgress: boolean;
  resumable: boolean;
  expandable: boolean;
}

/**
 * Complete integration hook that returns everything needed for CapsuleAction registration.
 *
 * Provides a turnkey API for integrating task generation into CapsuleActions.
 * Can be used with just the required props for default behavior, or customized with
 * optional parameters.
 *
 * Example:
 * ```typescript
 * const taskAction = useTaskGenerationCapsuleAction({
 *   aboutId: adrId,
 *   aboutType: "design-doc",
 *   projectId,
 *   organizationId,
 * });
 *
 * <CapsuleAction {...taskAction} icon={TasksIcon} />
 * ```
 */
export const useTaskGenerationCapsuleAction = (
  props: UseTaskGenerationCapsuleActionProps
): UseTaskGenerationCapsuleActionResult => {
  const {
    aboutId,
    aboutType,
    aboutTitle,
    projectId,
    organizationId,
    status,
    actionId = "tasks-generation",
    label = "Tasks",
    title = "Task Generation",
  } = props;

  // Get menu items
  const menuItems = useTaskGenerationMenuItems();

  // Check for existing conversation
  const { data: existingConversation } = useConversation(
    organizationId,
    projectId,
    {
      workflowName: "task-generation",
      workflowAboutId: aboutId,
    },
    { enabled: true, enablePolling: false, includeSuggestionDecisions: true }
  );

  // Render callback
  const renderContent = useCallback(() => {
    return (
      <TaskGenerationContent
        aboutId={aboutId}
        aboutType={aboutType}
        aboutTitle={aboutTitle}
        projectId={projectId}
        organizationId={organizationId}
        status={status}
      />
    );
  }, [aboutId, aboutType, aboutTitle, projectId, organizationId, status]);

  return {
    behavior: "expand",
    actionId,
    label,
    title,
    menuItems,
    renderContent,
    inProgress: !!existingConversation,
    resumable: true,
    expandable: true,
  };
};
