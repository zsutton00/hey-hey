import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { LegalDocumentLinks } from "../LegalDocumentLinks";

interface PublicMarketingShellProps {
  children: ReactNode;
}

export const PublicMarketingShell = ({
  children,
}: PublicMarketingShellProps) => (
  <Box
    data-testid="public-marketing-shell"
    sx={{
      display: "flex",
      flexDirection: "column",
      minHeight: "100vh",
      minWidth: 0,
      bgcolor: "background.default",
    }}
  >
    <Box
      data-testid="public-marketing-content"
      sx={{
        flexGrow: 1,
        minWidth: 0,
        // The shell owns the viewport minimum; page roots must size to content.
        "& > main": {
          minHeight: "auto !important",
        },
      }}
    >
      {children}
    </Box>
    <Box
      component="footer"
      aria-label="Legal disclosures"
      data-testid="site-legal-footer"
      sx={{
        position: "static",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        flexShrink: 0,
        gap: 2,
        px: { xs: 2, sm: 3 },
        py: 3,
        borderTop: 1,
        borderColor: "divider",
      }}
    >
      <Typography variant="caption" color="text.secondary">
        Hey Hey beta
      </Typography>
      <LegalDocumentLinks />
    </Box>
  </Box>
);
