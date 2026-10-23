import {
  Box,
  Alert,
  Button,
  Card,
  CardContent,
  Container,
  Stack,
  Typography,
} from "@mui/material";
import { HeyHeyBranding } from "@hey-hey/ui-common/components";
import { RequestAccessConfirmation } from "./RequestAccessConfirmation";
import { RequestAccessForm } from "./RequestAccessForm";
import { useRequestAccess } from "./useRequestAccess";
import { usePublicAdmissionMode } from "./usePublicAdmissionMode";

export const RequestAccessPage = () => {
  const requestAccess = useRequestAccess();
  const admission = usePublicAdmissionMode();

  return (
    <Box
      component="main"
      data-testid="request-access-page"
      sx={{
        minHeight: "100vh",
        backgroundColor: "background.default",
        backgroundImage: "none",
        overflowX: "hidden",
      }}
    >
      <Box
        data-testid="request-access-branding"
        sx={{
          backgroundColor: "#333",
          color: "white",
          "& .MuiTypography-root": {
            color: "common.white",
          },
          px: { xs: 3, sm: 4 },
          py: { xs: 5, sm: 7 },
        }}
      >
        <Container
          data-testid="request-access-branding-content"
          maxWidth="md"
          sx={{ textAlign: "center" }}
        >
          <Stack spacing={{ xs: 2, sm: 2.5 }} alignItems="center">
            <HeyHeyBranding variant="hero" />
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="md" sx={{ py: { xs: 4, sm: 6 } }}>
        <Stack spacing={{ xs: 3, sm: 4 }}>
          <Box sx={{ textAlign: "center" }}>
            <Typography
              component="h1"
              variant="h2"
              sx={{
                fontSize: { xs: "2.25rem", sm: "3rem" },
                fontWeight: 700,
                mb: 2,
              }}
            >
              Sign up for the beta
            </Typography>
          </Box>

          <Card
            elevation={3}
            sx={{ borderRadius: 2, overflow: "hidden", width: "100%" }}
          >
            <CardContent sx={{ p: { xs: 3, sm: 5 } }}>
              <Stack spacing={4}>
                <Box
                  sx={{
                    p: { xs: 2.5, sm: 3 },
                    borderRadius: 2,
                    backgroundColor: "action.hover",
                  }}
                >
                  <Typography color="text.secondary">
                    Hey Hey is still in beta. We use it every day, but you may
                    encounter bugs.
                  </Typography>
                </Box>
                {admission.status === "loading" ? (
                  <Typography role="status">
                    Loading signup information…
                  </Typography>
                ) : admission.status === "error" ? (
                  <Alert severity="error">
                    Signup information could not be loaded.
                    <Button onClick={() => void admission.retry()}>
                      Retry
                    </Button>
                    <Button href="/login">Existing User Sign In</Button>
                  </Alert>
                ) : requestAccess.accepted ? (
                  <RequestAccessConfirmation mode={admission.mode} />
                ) : (
                  <>
                    <Typography color="text.secondary">
                      {admission.mode === "PAUSED"
                        ? "Hey Hey is in beta, and we are currently reviewing new signups to keep up with capacity."
                        : "Sign up and check your inbox for an activation link to set your password."}
                    </Typography>
                    <RequestAccessForm
                      errors={requestAccess.errors}
                      hasAttemptedSubmit={requestAccess.hasAttemptedSubmit}
                      isSubmitting={requestAccess.isSubmitting}
                      onChange={requestAccess.handleChange}
                      onSubmit={requestAccess.handleSubmit}
                      submitError={requestAccess.submitError}
                      values={requestAccess.values}
                    />
                  </>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </Box>
  );
};

export default RequestAccessPage;
