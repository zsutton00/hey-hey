import { useContext } from "react";
import { InlineReconciliationBodyContext } from "../ProposalReconciliation/ProposalReconciliationReview";
import { usePathService } from "../../contexts/PathServiceContext";
import { Link } from "@mui/material";
import {
  Box,
  Stack,
  Typography,
  type SxProps,
  type Theme,
} from "@mui/material";
import type { FC, ReactNode } from "react";
import {
  ProposalAction,
  ProposalStatus,
  TargetEntityType,
  type ProposalResponseDto,
} from "../../api";
import { EntityLinkWithPreview } from "../Entity";
import { InteractionComponent } from "../InteractionComponent";
import { getProposalDisplayTitle } from "./getProposalDisplayTitle";
import {
  ProposalHeader,
  type ProposalHeaderTypePresentation,
} from "./ProposalHeader";
import { isPlaceholderEntityId } from "./types";
import { updateProposalTitleLinkSx } from "./updateProposalTitleLinkSx";

const titleFlexSx = { flex: 1, minWidth: 0 };
const titleLinkSx = {
  ...updateProposalTitleLinkSx,
  ...titleFlexSx,
  typography: "subtitle2",
};
const TITLE_DRAG_ENTITY_TYPES = [
  TargetEntityType.Task,
  TargetEntityType.DesignDoc,
] as const satisfies readonly TargetEntityType[];

export interface ProposalTitleTarget {
  entityId: string;
  entityType?: TargetEntityType;
  href?: string;
  sx?: SxProps<Theme>;
}

interface ResolvedProposalTitleTarget extends Omit<
  ProposalTitleTarget,
  "entityType"
> {
  entityType: TargetEntityType;
}

export interface ProposalTitleProps {
  proposal: ProposalResponseDto;
  presentationAction?: ProposalAction;
  typePresentation: ProposalHeaderTypePresentation;
  /** Concrete materialized target data for CREATE titles that are not yet approved. */
  target?: ProposalTitleTarget;
  resolvedTargetName?: string;
  hideTypeChip?: boolean;
  hideHeaderMetadata?: boolean;
  titleSx?: SxProps<Theme>;
  titleTestId?: string;
  typeTestId?: string;
  endAdornment?: ReactNode;
}

const renderTitleMarkup = (
  proposal: ProposalResponseDto,
  title: string,
  target: ResolvedProposalTitleTarget,
  titleSx: SxProps<Theme>,
  titleTestId: string,
): ReactNode => {
  const sx = [
    titleLinkSx,
    ...(target.sx ? (Array.isArray(target.sx) ? target.sx : [target.sx]) : []),
    ...(titleSx ? (Array.isArray(titleSx) ? titleSx : [titleSx]) : []),
  ];
  return (
    <EntityLinkWithPreview
      label={title}
      entityId={target.entityId}
      entityType={target.entityType}
      organizationId={proposal.organizationId}
      projectId={proposal.projectId}
      href={target.href}
      sx={sx}
      testId={titleTestId}
    />
  );
};

export const ProposalTitle: FC<ProposalTitleProps> = ({
  proposal,
  presentationAction,
  typePresentation,
  target,
  resolvedTargetName,
  hideTypeChip = false,
  hideHeaderMetadata = false,
  titleSx,
  titleTestId = "proposal-title",
  typeTestId,
  endAdornment,
}) => {
  const reconciliationBody = useContext(InlineReconciliationBodyContext);
  const paths = usePathService();
  const deleteSx =
    proposal.action === "DELETE"
      ? { color: "text.secondary", textDecoration: "line-through" }
      : undefined;
  const resolvedTarget: ResolvedProposalTitleTarget = {
    ...target,
    entityId: target?.entityId ?? proposal.targetEntityId,
    entityType: target?.entityType ?? proposal.targetEntityType,
  };
  const hasResolvedTarget = !isPlaceholderEntityId(resolvedTarget.entityId);
  const isLinked =
    hasResolvedTarget &&
    (proposal.action !== ProposalAction.Create ||
      proposal.status === ProposalStatus.Approved ||
      target !== undefined);
  const isMenuEligible =
    isLinked &&
    proposal.status === ProposalStatus.Approved &&
    (proposal.action === ProposalAction.Create ||
      proposal.action === ProposalAction.Update);
  const isDragEligible =
    isMenuEligible &&
    TITLE_DRAG_ENTITY_TYPES.some(
      (entityType) => entityType === resolvedTarget.entityType,
    );
  const title = resolvedTargetName?.trim() || getProposalDisplayTitle(proposal);
  const titleMarkup = isLinked ? (
    renderTitleMarkup(
      proposal,
      title,
      resolvedTarget,
      [
        ...(deleteSx ? [deleteSx] : []),
        ...(titleSx ? (Array.isArray(titleSx) ? titleSx : [titleSx]) : []),
      ],
      titleTestId,
    )
  ) : (
    <Typography
      variant="subtitle2"
      sx={
        titleSx
          ? [titleFlexSx, ...(Array.isArray(titleSx) ? titleSx : [titleSx])]
          : titleFlexSx
      }
      data-testid={titleTestId}
    >
      {title}
    </Typography>
  );
  const interactiveTitle = isMenuEligible ? (
    <Box component="span" sx={titleFlexSx} data-testid="proposal-title-layout">
      {/* Intentionally hide the sparkle on proposal titles while keeping entity interactions enabled. */}
      <InteractionComponent
        entityId={resolvedTarget.entityId}
        entityType={resolvedTarget.entityType}
        hasProposalSupport
        entityTitle={title}
        organizationId={proposal.organizationId}
        projectId={proposal.projectId}
        draggable={isDragEligible}
        showIndicator={false}
        surfaceLayout="inline"
      >
        {titleMarkup}
      </InteractionComponent>
    </Box>
  ) : (
    titleMarkup
  );

  return (
    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        data-testid="proposal-identity-header"
      >
        {interactiveTitle}
        {reconciliationBody ? (
          <Link
            data-testid="proposal-open-detail"
            href={paths.proposal({
              projectId: proposal.projectId,
              proposalId: proposal.id,
            })}
          >
            Open proposal
          </Link>
        ) : null}
        {!hideHeaderMetadata && (
          <ProposalHeader
            proposal={proposal}
            presentationAction={presentationAction}
            typePresentation={typePresentation}
            hideTypeChip={hideTypeChip}
            typeTestId={typeTestId}
            endAdornment={endAdornment}
          />
        )}
      </Stack>
      {!hideHeaderMetadata && proposal.eli5 !== undefined && (
        <Box>
          <Box
            sx={{
              px: 1.5,
              py: 1,
              borderRadius: 1,
              bgcolor: "action.hover",
              marginTop: 2,
              marginBottom: 2,
              minHeight: 60,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <Typography
              variant="body2"
              data-testid="proposal-eli5"
              sx={{
                fontSize: "1.15rem",
              }}
            >
              {proposal.eli5}
            </Typography>
          </Box>
        </Box>
      )}
    </Stack>
  );
};
