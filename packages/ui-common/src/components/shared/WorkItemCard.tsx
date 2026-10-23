import { Box, Card, CardContent } from "@mui/material";
import React, { useCallback } from "react";
import { FadeIn } from "../../animations";
import type { InitiativeResponseDto } from "../../api";
import { getWorkTypeTerm, capitalize } from "../../i18n/terminology";
import { useTypingAnimation } from "../../hooks/useTypingAnimation";
import { getWorkItemSectionContent } from "../../utils/workItemSections";
import {
  WorkItemStatusChip,
  WorkItemTitleSection,
  WorkItemDescriptionSection,
  WorkItemActionSection,
  type ActionButtonConfig,
} from "./WorkItemComponents";

export interface WorkItemCardProps {
  workType: "workstream" | "workitem";
  item: InitiativeResponseDto; // For now, using InitiativeResponseDto as base type
  onRefine: (item: InitiativeResponseDto) => void;
  onReject: (item: InitiativeResponseDto) => void;
  isReviewed?: boolean;
}

export const WorkItemCard: React.FC<WorkItemCardProps> = ({
  workType,
  item,
  onRefine,
  onReject,
  isReviewed = false,
}) => {
  const { displayedDescription, isTyping } = useTypingAnimation({
    description: getWorkItemSectionContent(item.sections, "description"),
    itemId: item.id,
    keyPrefix: workType,
    isReviewed,
    maxLength: 400,
    startDelay: 200,
  });

  // Get terminology for this work type
  const workTypeSingular = getWorkTypeTerm(workType, "singular");
  const workTypeSingularCapitalized = capitalize(workTypeSingular);

  const isActive = item.status === "ACTIVE";

  const handleRefine = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRefine(item);
    },
    [onRefine, item]
  );

  const handleReject = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onReject(item);
    },
    [onReject, item]
  );

  const actionButtons: ActionButtonConfig[] = [
    {
      label: `${isActive ? "Review" : "Refine"} ${workTypeSingularCapitalized}`,
      onClick: handleRefine,
      variant: "contained",
      color: !isActive ? "actionable" : "success",
    },
    {
      label: `Reject ${workTypeSingularCapitalized}`,
      onClick: handleReject,
      variant: "outlined",
      color: "error",
    },
  ];

  return (
    <Card
      data-testid="work-item-card"
      variant="outlined"
      sx={{
        mb: 2,
        position: "relative",
      }}
    >
      <CardContent>
        {/* Main content layout */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          {/* Left content area */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Status indicator */}
            <WorkItemStatusChip
              status={item.status}
              itemId={item.id}
              testIdPrefix={workType + "-card"}
            />

            {/* Title */}
            <WorkItemTitleSection name={item.name} tags={item.tags} />

            {/* Description with typing animation */}
            <Box>
              <WorkItemDescriptionSection
                displayedDescription={displayedDescription}
                isTyping={isTyping}
                maxWidth="100ch"
                marginBottom={1.5}
              />

              {/* Action buttons */}
              <FadeIn delay={0.3} duration="medium">
                <WorkItemActionSection buttons={actionButtons} />
              </FadeIn>
            </Box>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};
