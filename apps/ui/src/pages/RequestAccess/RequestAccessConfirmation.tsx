import { useEffect, useRef } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import { Link } from "react-router-dom";
import type { PrivateBetaSelfServiceAdmissionMode } from "@hey-hey/ui-common/api";

export const RequestAccessConfirmation = ({
  mode,
}: {
  mode: PrivateBetaSelfServiceAdmissionMode;
}) => {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <Box
      role="status"
      aria-live="polite"
      aria-labelledby="request-access-confirmation-title"
      data-testid="request-access-confirmation"
    >
      <Stack spacing={{ xs: 3, sm: 4 }} alignItems="flex-start">
        <Box>
          <Typography
            ref={headingRef}
            id="request-access-confirmation-title"
            component="h2"
            variant="h4"
            tabIndex={-1}
            sx={{ outline: "none" }}
            gutterBottom
          >
            Request received
          </Typography>
          <Typography color="text.secondary" paragraph>
            {mode === "OPEN"
              ? "Check your inbox for an activation link to set your password."
              : "Your request is waiting for review. We’ll email an activation link to set your password once approved."}
          </Typography>
          <Typography color="text.secondary">
            Already have an account? Continue with sign in.
          </Typography>
        </Box>

        <Button
          component={Link}
          to="/login"
          variant="outlined"
          size="large"
          sx={{
            alignSelf: { xs: "stretch", sm: "flex-start" },
            minWidth: { sm: 190 },
            textTransform: "none",
          }}
        >
          Existing User Sign In
        </Button>
      </Stack>
    </Box>
  );
};
