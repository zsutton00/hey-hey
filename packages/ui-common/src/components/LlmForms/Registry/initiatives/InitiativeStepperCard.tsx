import React from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import type { InitiativeResponseDto } from "../../../../api";
import { getWorkItemSectionContent } from "../../../../utils/workItemSections";
import {
  WorkItemStatusChip,
  WorkItemTitleSection,
} from "../../../shared/WorkItemComponents";

export interface InitiativeStepperCardProps {
  initiative: InitiativeResponseDto;
  onKeep: () => void;
  onReject: () => void;
  decisionStatus?: "accepted" | "rejected";
}

export const InitiativeStepperCard: React.FC<InitiativeStepperCardProps> = ({
  initiative,
  onKeep,
  onReject,
  decisionStatus,
}) => {
  const isDecided = Boolean(decisionStatus);
  const decisionLabel =
    decisionStatus === "accepted" ? "Added to Roadmap" : "Not for us";

  return (
    <Box data-testid="initiative-stepper-card" sx={{ py: 3 }}>
      {/* Status chip */}
      <WorkItemStatusChip
        status={initiative.status}
        itemId={initiative.id}
        testIdPrefix="initiative-stepper-card"
      />

      {/* Title and tags */}
      <WorkItemTitleSection name={initiative.name} tags={initiative.tags} />

      {/* Description */}
      <Box sx={{ mb: 3 }}>
        <Typography
          variant="body1"
          sx={{
            color: "text.primary",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {getWorkItemSectionContent(initiative.sections, "description")}
        </Typography>
      </Box>

      {/* Action buttons - same line, left-aligned */}
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Button
          variant="contained"
          color="actionable"
          size="large"
          onClick={onKeep}
          data-testid="keep-initiative-button"
          disabled={isDecided}
        >
          Add to Roadmap
        </Button>

        <Button
          variant="outlined"
          size="large"
          onClick={onReject}
          data-testid="reject-initiative-button"
          disabled={isDecided}
        >
          Not for us
        </Button>
        {isDecided && (
          <Typography variant="caption" color="text.secondary">
            {decisionLabel}
          </Typography>
        )}
      </Stack>
    </Box>
  );
};
