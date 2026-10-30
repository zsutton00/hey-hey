import { Chip, Stack, type SvgIconProps } from "@mui/material";
import type { ComponentType, FC, ReactNode } from "react";
import { ProposalAction, type ProposalResponseDto } from "../../api";
import { isFutureProposal } from "./futureAsUpdate";
import type { EntityColors } from "../../utils/entityIcons";

export type ProposalHeaderTypePresentation =
  | { kind: "loading" }
  | {
      kind: "available";
      label: string;
      Icon: ComponentType<SvgIconProps>;
      colors?: EntityColors;
    };

export interface ProposalMetadataProps {
  action: ProposalAction;
  actionLabel?: string;
  typePresentation: ProposalHeaderTypePresentation;
  hideTypeChip?: boolean;
  typeTestId?: string;
  endAdornment?: ReactNode;
}

export interface ProposalHeaderProps {
  proposal: ProposalResponseDto;
  typePresentation: ProposalMetadataProps["typePresentation"];
  presentationAction?: ProposalAction;
  hideTypeChip?: ProposalMetadataProps["hideTypeChip"];
  typeTestId?: ProposalMetadataProps["typeTestId"];
  endAdornment?: ProposalMetadataProps["endAdornment"];
}

export const formatProposalAction = (action: ProposalAction): string =>
  action === "VERSIONED_UPDATE"
    ? "Future revision"
    : action.charAt(0) + action.slice(1).toLowerCase();

export const ProposalHeader: FC<ProposalHeaderProps> = ({
  proposal,
  typePresentation,
  hideTypeChip = false,
  typeTestId = "proposal-header-type",
  endAdornment,
  presentationAction,
}) => (
  <ProposalMetadata
    action={presentationAction ?? proposal.action}
    actionLabel={
      presentationAction === ProposalAction.VersionedUpdate ||
      (isFutureProposal(proposal) && proposal.updates.operation === "REVISE")
        ? "Updates after linked work"
        : undefined
    }
    typePresentation={typePresentation}
    hideTypeChip={hideTypeChip}
    typeTestId={typeTestId}
    endAdornment={endAdornment}
  />
);

export const ProposalMetadata: FC<ProposalMetadataProps> = ({
  action,
  actionLabel,
  typePresentation,
  hideTypeChip = false,
  typeTestId = "proposal-header-type",
  endAdornment,
}) => (
  <Stack
    direction="row"
    spacing={1}
    alignItems="center"
    flexWrap="wrap"
    useFlexGap
    data-testid="proposal-header-metadata"
  >
    <Chip
      label={actionLabel ?? formatProposalAction(action)}
      size="small"
      color="primary"
      data-testid="proposal-header-action"
    />
    {!hideTypeChip && (
      <ProposalTypeChip presentation={typePresentation} testId={typeTestId} />
    )}
    {endAdornment}
  </Stack>
);

const ProposalTypeChip: FC<{
  presentation: ProposalHeaderTypePresentation;
  testId: string;
}> = ({ presentation, testId }) => {
  if (presentation.kind === "loading") {
    return (
      <Chip
        label="Loading type…"
        size="small"
        variant="outlined"
        data-testid={testId}
      />
    );
  }

  const { Icon, label } = presentation;
  return (
    <Chip
      icon={<Icon />}
      label={label}
      size="small"
      variant={presentation.colors ? "filled" : "outlined"}
      sx={
        presentation.colors
          ? {
              backgroundColor: presentation.colors.background,
              color: presentation.colors.color,
              "& .MuiChip-icon": { color: "inherit" },
            }
          : undefined
      }
      data-testid={testId}
    />
  );
};
