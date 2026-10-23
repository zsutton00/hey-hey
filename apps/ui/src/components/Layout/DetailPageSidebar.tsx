import React from "react";
import { Box, Stack, useMediaQuery, useTheme } from "@mui/material";

export interface DetailPageSidebarProps {
  navigation: React.ReactNode;
  metadata: React.ReactNode;
}

export const DetailPageSidebar: React.FC<DetailPageSidebarProps> = ({
  navigation,
  metadata,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  if (isMobile) {
    // On mobile, stack vertically
    return (
      <Stack spacing={2}>
        {navigation}
        {metadata}
      </Stack>
    );
  }

  // On desktop, two-column layout
  return (
    <Box
      sx={{
        display: "flex",
        gap: 2,
        width: "100%",
        minWidth: 0,
      }}
    >
      {navigation && <Box sx={{ flex: "0 0 auto", minWidth: 160 }}>{navigation}</Box>}
      {metadata && <Box sx={{ flex: 1, minWidth: 0 }}>{metadata}</Box>}
    </Box>
  );
};
