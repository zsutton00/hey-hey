import React from "react";
import { Box, Stack, Typography } from "@mui/material";
import { usePreviewPresentation } from "../../contexts/PreviewPresentationContext";

export interface DetailPageHeaderProps {
  title: React.ReactNode;
  subtitle?: string;
  metadataComponent?: React.ReactNode;
  priorityChip?: React.ReactNode;
  metadata?: React.ReactNode;
  actions?: React.ReactNode;
  hideTitleOnMobile?: boolean;
}

export const DetailPageHeader: React.FC<DetailPageHeaderProps> = ({
  title,
  subtitle,
  metadataComponent,
  metadata,
  actions,
  hideTitleOnMobile = false,
}) => {
  const isPreviewPresentation = usePreviewPresentation();
  if (isPreviewPresentation) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", md: "center" }}
        spacing={2}
      >
        <Box sx={{ flex: 1, width: "100%" }}>
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{
              mb: 1,
              flexWrap: "wrap",
              display: hideTitleOnMobile ? { xs: "none", md: "flex" } : "flex",
            }}
          >
            {typeof title === "string" ? (
              <Typography
                component="h2"
                variant="h4"
                sx={{
                  fontFamily:
                    '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
                  fontWeight: 600,
                }}
              >
                {title}
              </Typography>
            ) : (
              title
            )}
          </Stack>

          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {subtitle}
            </Typography>
          )}

          <Box flex="0 0 130px">{metadataComponent}</Box>

          {metadata && (
            <Typography variant="body2" color="text.secondary">
              {metadata}
            </Typography>
          )}
        </Box>
      </Stack>
      {actions && <Box>{actions}</Box>}
    </Box>
  );
};
