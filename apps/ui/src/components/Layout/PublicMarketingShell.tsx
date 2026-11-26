import { Box, Link, SvgIcon, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { landingPageCopy } from "../Homepage/landingPageCopy";
import { LegalDocumentLinks } from "../LegalDocumentLinks";

const { sourceLink } = landingPageCopy;

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
      position: "relative",
      bgcolor: "background.default",
    }}
  >
    <Link
      href={sourceLink.href}
      underline="hover"
      data-testid="public-source-link"
      sx={{
        position: "absolute",
        top: { xs: 4, sm: 16 },
        right: { xs: 4, sm: 16 },
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        gap: "6px",
        px: 1,
        py: 0.5,
        borderRadius: "4px",
        // Every public page opens on this dark surface; carrying it keeps the
        // link readable while a page is still loading.
        bgcolor: "#333",
        color: "common.white",
        fontSize: "0.875rem",
        lineHeight: "20px",
        "&:focus-visible": { outline: "3px solid #087e8b", outlineOffset: 2 },
      }}
    >
      <SvgIcon sx={{ fontSize: 20 }}>
        <path d={sourceLink.iconPath} />
      </SvgIcon>
      {sourceLink.label}
    </Link>
    <Box
      data-testid="public-marketing-content"
      sx={{
        flexGrow: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        // The shell owns the viewport minimum; page roots size to content and
        // grow to fill the space above the footer.
        "& > main": {
          minHeight: "auto !important",
          flexGrow: 1,
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
