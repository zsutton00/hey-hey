import React from "react";
import {
  Box,
  Paper,
  useMediaQuery,
  useTheme,
  type SxProps,
  type Theme,
} from "@mui/material";

export interface DetailPageContainerProps {
  children: React.ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl" | false;
  rootSx?: SxProps<Theme>;
  paperSx?: SxProps<Theme>;
}

export const DetailPageContainer = React.forwardRef<
  HTMLDivElement,
  DetailPageContainerProps
>(function DetailPageContainer(
  { children, maxWidth = false, rootSx, paperSx },
  ref,
) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const containerSx: SxProps<Theme> = [
    {
      // Auto margins center capped pages, but must not shrink a page inside
      // the expanded preview's column flex layout.
      width: "100%",
      minWidth: 0,
      boxSizing: "border-box",
      maxWidth:
        maxWidth === false
          ? "none"
          : (currentTheme) => currentTheme.breakpoints.values[maxWidth],
      mx: "auto",
      px: { xs: 0, md: 2 },
      pb: 2,
      pt: 1,
    },
    ...(Array.isArray(rootSx) ? rootSx : [rootSx]),
  ];
  const resolvedPaperSx: SxProps<Theme> = [
    isMobile
      ? { border: 0, p: 0, background: "none" }
      : { border: 1, borderColor: "divider", p: 2.5 },
    ...(Array.isArray(paperSx) ? paperSx : [paperSx]),
  ];

  return (
    <Box ref={ref} data-testid="detail-page-container" sx={containerSx}>
      <Paper
        data-testid="detail-page-container-paper"
        elevation={0}
        sx={resolvedPaperSx}
      >
        {children}
      </Paper>
    </Box>
  );
});
