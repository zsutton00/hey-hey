import {
  Box,
  Chip,
  Container,
  Divider,
  Link,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { LegalDocumentLinks } from "../../components/LegalDocumentLinks";
import {
  DISCLOSURE_EFFECTIVE_DATE,
  DISCLOSURE_VERSION,
  LEGAL_ROUTES,
  type LegalDocument,
} from "./legalContent";

export const PublishedLegalDocument = ({
  document,
}: {
  document: LegalDocument;
}) => (
  <Container maxWidth="md" sx={{ py: { xs: 4, md: 8 }, px: { xs: 2, sm: 3 } }}>
    <Paper
      component="article"
      data-testid={`legal-document-${document.key}`}
      sx={{ p: { xs: 3, sm: 5, md: 7 } }}
    >
      <Stack spacing={3}>
        <Box>
          <Typography
            variant="overline"
            color="primary"
            sx={{ letterSpacing: 1.2 }}
          >
            Hey Hey beta
          </Typography>
          <Typography variant="h3" component="h1" sx={{ mt: 1 }}>
            {document.title}
          </Typography>
          <Typography
            variant="h6"
            color="text.secondary"
            sx={{ mt: 2, fontWeight: 400 }}
          >
            {document.summary}
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 3 }}>
            <Chip label={`Version ${DISCLOSURE_VERSION}`} size="small" />
            <Chip
              label={`Effective ${DISCLOSURE_EFFECTIVE_DATE}`}
              size="small"
            />
          </Stack>
        </Box>

        <Divider />

        <Box component="nav" aria-label={`${document.title} sections`}>
          <Typography variant="subtitle2" component="h2" gutterBottom>
            On this page
          </Typography>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
            {document.sections.map((section) => (
              <Box component="li" key={section.id}>
                <Link href={`#${section.id}`} underline="hover">
                  {section.heading}
                </Link>
              </Box>
            ))}
          </Stack>
        </Box>

        <Stack spacing={5}>
          {document.sections.map((section) => (
            <Box
              component="section"
              id={section.id}
              key={section.id}
              data-testid={`legal-section-${section.id}`}
              sx={{ scrollMarginTop: 88 }}
            >
              <Typography variant="h5" component="h2" gutterBottom>
                {section.heading}
              </Typography>
              <Stack spacing={2}>
                {section.claims.map((publishedClaim) => (
                  <Typography
                    component="p"
                    key={publishedClaim.id}
                    data-claim-id={publishedClaim.id}
                    sx={{ m: 0, lineHeight: 1.75 }}
                  >
                    {publishedClaim.text}
                  </Typography>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>

        <Divider />

        <Stack spacing={1}>
          <Typography variant="subtitle2" component="h2">
            Related disclosures
          </Typography>
          <LegalDocumentLinks />
          {document.key !== "security" && (
            <Typography variant="body2" color="text.secondary">
              The detailed technical boundary is in the{" "}
              <Link component={RouterLink} to={LEGAL_ROUTES.security}>
                Agent Bridge Security Boundary
              </Link>
              .
            </Typography>
          )}
        </Stack>
      </Stack>
    </Paper>
  </Container>
);
