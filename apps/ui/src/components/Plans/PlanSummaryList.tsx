import type { PlanWorkItem } from "@hey-hey/ui-common/data";
import { getEntityColors, getPlanStatusLabel } from "@hey-hey/ui-common/utils";
import AssignmentOutlined from "@mui/icons-material/AssignmentOutlined";
import {
  Avatar,
  Box,
  Chip,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import React from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { buildPlanDetailPath } from "../../pages/Plan/planSessionRoutes";

const getPlanNavigationPath = (
  projectId: string,
  plan: PlanWorkItem
): string => {
  return buildPlanDetailPath(projectId, plan.id);
};

interface PlanSummaryListProps {
  plans: PlanWorkItem[];
  projectId: string;
  isLoading?: boolean;
  loadingText?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  renderActions?: (plan: PlanWorkItem) => ReactNode;
}

export const PlanSummaryList: React.FC<PlanSummaryListProps> = ({
  plans,
  projectId,
  isLoading = false,
  loadingText = "Loading plans...",
  emptyTitle = "No plans yet.",
  emptyDescription = "Plans help you execute high-level goals with Hey Hey's assistance.",
  renderActions,
}) => {
  const planColors = getEntityColors("plan");

  if (isLoading) {
    return <Typography variant="body2">{loadingText}</Typography>;
  }

  if (plans.length === 0) {
    return (
      <Stack spacing={1}>
        <Typography variant="body2">{emptyTitle}</Typography>
        <Typography variant="body2" color="text.secondary">
          {emptyDescription}
        </Typography>
      </Stack>
    );
  }

  return (
    <List disablePadding dense>
      {plans.map((plan) => {
        const planUrl = getPlanNavigationPath(projectId, plan);
        const actions = renderActions?.(plan);

        return (
          <ListItem
            key={plan.id}
            disablePadding
            secondaryAction={actions}
            sx={{ borderRadius: 1 }}
          >
            <ListItemButton
              component={Link}
              to={planUrl}
              sx={{
                borderRadius: 1,
                color: "inherit",
                textDecoration: "none",
                px: 2,
                py: 1,
                pr: actions ? 10 : 2,
                "&:hover": {
                  bgcolor: "action.hover",
                },
              }}
            >
              <Avatar
                sx={{
                  width: 40,
                  height: 40,
                  mr: 2,
                  bgcolor: planColors.background,
                  color: planColors.color,
                }}
              >
                <AssignmentOutlined sx={{ fontSize: 24 }} />
              </Avatar>
              <ListItemText
                primary={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="body2" component="span">
                      {plan.name}
                    </Typography>
                    <Chip
                      label={getPlanStatusLabel(plan.status)}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: "0.7rem",
                        fontWeight: 500,
                      }}
                    />
                  </Box>
                }
              />
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );
};
