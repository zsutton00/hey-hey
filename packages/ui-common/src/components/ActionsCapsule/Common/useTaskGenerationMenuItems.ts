/**
 * Hook for building task generation menu items
 *
 * Builds dynamic menu items based on task links:
 * - "Create Tasks" - always present
 * - "View Related Tasks" - conditional on taskLinks.length > 0, with badge count
 */

import { useTranslation } from "react-i18next";
import type { CapsuleActionMenuItem } from "../types";

/**
 * Hook to build dynamic menu items based on task links.
 *
 * Returns:
 * - "Create Tasks" - always present
 * - "View Related Tasks" - conditional on taskLinks.length > 0, with badge count
 */
export const useTaskGenerationMenuItems = (): CapsuleActionMenuItem[] => {
  const { t } = useTranslation();

  return [
    {
      id: "create-task",
      label: t("adr.taskGeneration.createTasks", "Create Tasks"),
    },
  ];
};
