import { Box, Paper, Stack, Typography } from "@mui/material";
import React from "react";
import { getEntityIcon } from "../../../utils/entityIcons";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";

interface FeatureListChildItem {
  id: string;
  name: string;
  description: string;
}

export interface FeatureListChildrenProps {
  items: readonly FeatureListChildItem[];
}

const FeatureIcon = getEntityIcon("feature");

export const FeatureListChildren: React.FC<FeatureListChildrenProps> = ({
  items,
}) => {
  if (items.length === 0) return null;

  return (
    <Box
      data-testid="feature-list-children"
      sx={{
        mb: 2,
        ml: 1,
        pl: 2.5,
        borderLeft: "1px solid",
        borderColor: "heyhey.main",
      }}
    >
      <Stack spacing={1.5}>
        {items.map((child) => (
          <Paper
            key={child.id}
            variant="outlined"
            data-testid="feature-list-child-card"
            data-feature-id={child.id}
            sx={(theme) => ({
              p: 1.5,
              position: "relative",
              "&::before": {
                content: '""',
                position: "absolute",
                left: theme.spacing(-2.5),
                top: theme.spacing(2.75),
                width: theme.spacing(2.5),
                height: "1px",
                bgcolor: "heyhey.main",
              },
            })}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ mb: child.description ? 0.5 : 0 }}
            >
              <FeatureIcon
                aria-hidden="true"
                fontSize="small"
                sx={{ color: "feature.main", flexShrink: 0 }}
                data-testid="feature-list-child-icon"
              />
              <Typography
                variant="subtitle2"
                color="text.secondary"
                component="div"
                sx={{ flex: 1, minWidth: 0 }}
              >
                {child.name}
              </Typography>
            </Stack>
            {child.description && (
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
              >
                <MarkdownRenderer>{child.description}</MarkdownRenderer>
              </Typography>
            )}
          </Paper>
        ))}
      </Stack>
    </Box>
  );
};
