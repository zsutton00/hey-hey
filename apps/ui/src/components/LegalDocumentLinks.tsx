import { Box, Link } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { LEGAL_DOCUMENTS, LEGAL_ROUTES } from "../pages/Legal/legalContent";

interface LegalDocumentLinksProps {
  color?: string;
}

export const LegalDocumentLinks = ({
  color = "text.primary",
}: LegalDocumentLinksProps) => (
  <Box
    component="nav"
    aria-label="Legal disclosures"
    data-testid="legal-document-links"
    sx={{
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
      gap: { xs: 1, sm: 1.5 },
    }}
  >
    {(Object.keys(LEGAL_ROUTES) as Array<keyof typeof LEGAL_ROUTES>).map(
      (key) => (
        <Link
          key={key}
          component={RouterLink}
          to={LEGAL_ROUTES[key]}
          color={color}
          underline="hover"
          data-testid={`legal-link-${key}`}
          sx={{ fontSize: { xs: "0.75rem", sm: "0.8125rem" } }}
        >
          {LEGAL_DOCUMENTS[key].shortTitle}
        </Link>
      ),
    )}
  </Box>
);

