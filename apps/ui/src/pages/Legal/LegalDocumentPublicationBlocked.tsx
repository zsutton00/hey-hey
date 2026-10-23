import { Container, Paper, Typography } from "@mui/material";

export const LegalDocumentPublicationBlocked = () => (
  <Container maxWidth="md" sx={{ py: { xs: 4, md: 8 } }}>
    <Paper component="section" sx={{ p: { xs: 3, md: 5 } }}>
      <Typography variant="h1" component="h1" gutterBottom>
        Disclosure temporarily unavailable
      </Typography>
      <Typography color="text.secondary">
        This disclosure is not published until the matching release evidence has
        passed review. Please try again later.
      </Typography>
    </Paper>
  </Container>
);
