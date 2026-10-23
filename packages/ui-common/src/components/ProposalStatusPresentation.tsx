import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import PriorityHighIcon from "@mui/icons-material/PriorityHigh";
import { Chip, useMediaQuery, useTheme } from "@mui/material";
import React from "react";
import { ProposalStatus } from "../api";

const STATUS_LABELS: Record<ProposalStatus, string> = {
  [ProposalStatus.Draft]: "Needs review",
  [ProposalStatus.Approved]: "Approved",
  [ProposalStatus.Rejected]: "Rejected",
};

const STATUS_COLORS: Record<ProposalStatus, "default" | "success" | "error"> = {
  [ProposalStatus.Draft]: "default",
  [ProposalStatus.Approved]: "success",
  [ProposalStatus.Rejected]: "error",
};

export interface ProposalStatusPresentationProps {
  status: ProposalStatus;
  "data-testid"?: string;
}

const StatusIcon: React.FC<{ status: ProposalStatus }> = ({ status }) => {
  switch (status) {
    case ProposalStatus.Approved:
      return <CheckIcon aria-hidden="true" />;
    case ProposalStatus.Rejected:
      return <CloseIcon aria-hidden="true" />;
    case ProposalStatus.Draft:
      return <PriorityHighIcon aria-hidden="true" />;
    default: {
      const unhandledStatus: never = status;
      return unhandledStatus;
    }
  }
};

export const ProposalStatusPresentation: React.FC<
  ProposalStatusPresentationProps
> = ({ status, "data-testid": dataTestId }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const label = STATUS_LABELS[status];
  const isCompact = isMobile && status !== ProposalStatus.Draft;

  return (
    <Chip
      aria-label={label}
      color={STATUS_COLORS[status]}
      icon={isCompact ? <StatusIcon status={status} /> : undefined}
      label={isCompact ? undefined : label}
      size="small"
      data-testid={dataTestId}
      sx={{
        width: isCompact ? 30 : undefined,
        height: isCompact ? 30 : undefined,
        minWidth: isCompact ? 30 : undefined,
        flexShrink: isCompact ? 0 : undefined,
        padding: isCompact ? 0 : undefined,
        borderRadius: isCompact ? "50%" : undefined,
        "& .MuiChip-icon": {
          margin: isCompact ? 0 : undefined,
        },
        "& .MuiChip-label": {
          padding: isCompact ? 0 : undefined,
        },
      }}
    />
  );
};
