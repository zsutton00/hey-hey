import { Alert, Box, Button, Typography } from "@mui/material";
import {
  BRANDED_NESTED_FILL,
  BrandedCard,
  BrandedHeadline,
  BrandedPage,
  BrandedWordmark,
} from "@hey-hey/ui-common/components";
import { RequestAccessConfirmation } from "./RequestAccessConfirmation";
import { RequestAccessForm } from "./RequestAccessForm";
import { useRequestAccess } from "./useRequestAccess";
import { usePublicAdmissionMode } from "./usePublicAdmissionMode";

const MUTED_TEXT_SX = { color: "rgb(255 255 255 / 72%)" } as const;

export const RequestAccessPage = () => {
  const requestAccess = useRequestAccess();
  const admission = usePublicAdmissionMode();

  return (
    <BrandedPage data-testid="request-access-page">
      <BrandedWordmark>HEY HEY</BrandedWordmark>
      <BrandedHeadline>Sign up for the beta</BrandedHeadline>
      <BrandedCard sx={{ maxWidth: "720px", p: { xs: 2.5, sm: 4 } }}>
        <Box sx={{ display: "grid", gap: 3 }}>
          <Box
            sx={{ p: 2, borderRadius: "6px", background: BRANDED_NESTED_FILL }}
          >
            <Typography sx={MUTED_TEXT_SX}>
              Hey Hey is still in beta. We use it every day, but you may
              encounter bugs.
            </Typography>
          </Box>
          {admission.status === "loading" ? (
            <Typography role="status">Loading signup information…</Typography>
          ) : admission.status === "error" ? (
            <Alert severity="error">
              Signup information could not be loaded.
              <Button onClick={() => void admission.retry()}>Retry</Button>
              <Button href="/login">Existing User Sign In</Button>
            </Alert>
          ) : requestAccess.accepted ? (
            <RequestAccessConfirmation mode={admission.mode} />
          ) : (
            <>
              <Typography sx={MUTED_TEXT_SX}>
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
        </Box>
      </BrandedCard>
    </BrandedPage>
  );
};

export default RequestAccessPage;
