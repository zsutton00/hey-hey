import { Box, Chip, Stack, Typography } from "@mui/material";
import React from "react";
import { Link as RouterLink } from "react-router-dom";
import type { Influence, ProposalResponseDto } from "../../api";
import { usePathService } from "../../contexts";
import { CardHeader } from "../CardHeader/CardHeader";
import { EntityLinkWithPreview } from "../Entity";

export interface ProposalInfluencesBlockProps {
  organizationId: string;
  projectId: string;
  proposal: ProposalResponseDto;
}

type ReasonType =
  | "explicit_mention"
  | "implied"
  | "derived"
  | "origin"
  | "user_reason"
  | string;

const REASON_LABEL: Record<string, string> = {
  explicit_mention: "Mentioned",
  implied: "Implied",
  derived: "Derived",
  origin: "Origin",
  user_reason: "User reason",
};

const reasonLabel = (reasonType: ReasonType): string =>
  REASON_LABEL[reasonType] ?? "Related context";

const formatEntityType = (entityType: string): string =>
  entityType
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");

const buildEntityLabel = (influence: Influence): string => {
  if (influence.entityTitle && influence.entityTitle.trim().length > 0) {
    return influence.entityTitle;
  }
  return `${formatEntityType(influence.entityType)} name unavailable`;
};

export const ProposalInfluencesBlock: React.FC<
  ProposalInfluencesBlockProps
> = ({ organizationId, projectId, proposal }) => {
  const pathService = usePathService();
  const influences = proposal.influences ?? [];

  if (influences.length === 0) {
    return null;
  }

  const originConversationHref = proposal.conversationId
    ? pathService.conversation({
        projectId,
        conversationId: proposal.conversationId,
      })
    : undefined;

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 2,
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
      }}
      data-testid="proposal-influences-block"
    >
      <Stack spacing={1.25} sx={{ minWidth: 0 }}>
        <CardHeader title="Influences" />
        <Stack spacing={1.25}>
          {influences.map((influence, index) => {
            const isOrigin = influence.reasonType === "origin";
            const showOriginLink = isOrigin && originConversationHref;
            return (
              <Stack
                key={`${influence.entityType}-${influence.entityId}-${influence.reasonType}-${index}`}
                spacing={0.5}
                sx={{ minWidth: 0 }}
                data-testid={
                  isOrigin
                    ? "proposal-influence-origin"
                    : "proposal-influence-row"
                }
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                  sx={{ minWidth: 0 }}
                >
                  <EntityLinkWithPreview
                    label={buildEntityLabel(influence)}
                    entityId={influence.entityId}
                    entityType={influence.entityType}
                    organizationId={organizationId}
                    projectId={projectId}
                  />
                  <Chip
                    label={reasonLabel(influence.reasonType)}
                    size="small"
                    color={isOrigin ? "primary" : "default"}
                    variant={isOrigin ? "filled" : "outlined"}
                    data-testid={`proposal-influence-chip-${influence.reasonType}`}
                  />
                  {showOriginLink && (
                    <Typography
                      component={RouterLink}
                      to={originConversationHref}
                      variant="caption"
                      sx={{
                        color: "primary.main",
                        textDecoration: "none",
                        "&:hover": { textDecoration: "underline" },
                      }}
                      data-testid="proposal-influence-origin-link"
                    >
                      View conversation
                    </Typography>
                  )}
                </Stack>
                {influence.reasoning &&
                  influence.reasoning.trim().length > 0 && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                      }}
                      title={influence.reasoning}
                    >
                      {influence.reasoning}
                    </Typography>
                  )}
              </Stack>
            );
          })}
        </Stack>
      </Stack>
    </Box>
  );
};

ProposalInfluencesBlock.displayName = "ProposalInfluencesBlock";
