import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { BrowserOrganizationSelectionDto } from "../../api";

interface OrganizationHomeSelectionProps {
  selection: BrowserOrganizationSelectionDto;
  pending: boolean;
  error: string | null;
  onSelect: (organizationId: string) => void;
  onSignOut: () => void;
}

/** Home before organization confirmation; never mounts organization-scoped data. */
export function OrganizationHomeSelection({
  selection,
  pending,
  error,
  onSelect,
  onSignOut,
}: OrganizationHomeSelectionProps) {
  return (
    <Box
      component="main"
      data-testid="organization-home-unselected"
      sx={{ py: { xs: 8, sm: 10 }, px: { xs: 2, sm: 3 } }}
    >
      <Container maxWidth="lg" disableGutters>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          spacing={3}
          sx={{ mb: 4 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              component="h1"
              variant="h3"
              data-testid="organization-home-title"
            >
              Home
            </Typography>
            <Typography variant="h6" sx={{ overflowWrap: "anywhere" }}>
              Hello, {selection.user.name}
            </Typography>
          </Box>
          <Button onClick={onSignOut} data-testid="organization-home-sign-out">
            Sign out
          </Button>
        </Stack>
        {selection.status === "selection_denied" && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Access to the selected organization was denied. Choose an available
            organization.
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Card
          component="section"
          aria-labelledby="organization-home-projects-heading"
          data-testid="organization-home-projects-card"
        >
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography component="h2" variant="h4" color="heyhey.main">
              Projects
            </Typography>
            <TextField
              select
              fullWidth
              label="Choose an organization"
              value=""
              disabled={pending || selection.organizations.length === 0}
              data-testid="organization-home-organization-picker"
              onChange={(event) => onSelect(event.target.value)}
              sx={{ mt: 2 }}
            >
              {selection.organizations.map((organization) => (
                <MenuItem
                  key={organization.id}
                  value={organization.id}
                  data-testid="organization-home-organization-option"
                  data-organization-id={organization.id}
                >
                  {organization.name}
                </MenuItem>
              ))}
            </TextField>
            {pending && (
              <Typography role="status" sx={{ mt: 1 }}>
                Confirming organization…
              </Typography>
            )}
            <Typography color="text.secondary" sx={{ py: 5 }}>
              {selection.organizations.length === 0
                ? "No accessible organizations. Contact your organization administrator."
                : "Choose an organization to see your projects and activity."}
            </Typography>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
