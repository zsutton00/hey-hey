import { useEffect, useRef } from "react";
import { Box, Stack, Typography } from "@mui/material";
import { BRANDED_LINK_SX } from "@hey-hey/ui-common/components";
import { Link } from "react-router-dom";
import type { PrivateBetaSelfServiceAdmissionMode } from "@hey-hey/contracts/api";

const MUTED_SX = { color: "rgb(255 255 255 / 72%)" } as const;

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
            sx={{ outline: "none", color: "#fff", fontWeight: 700 }}
            gutterBottom
          >
            Request received
          </Typography>
          <Typography sx={MUTED_SX} paragraph>
            {mode === "OPEN"
              ? "Check your inbox for an activation link to set your password."
              : "Your request is waiting for review. We’ll email an activation link to set your password once approved."}
          </Typography>
          <Typography sx={MUTED_SX}>
            Already have an account? Continue with sign in.
          </Typography>
        </Box>

        <Box component={Link} to="/login" sx={BRANDED_LINK_SX}>
          Existing User Sign In
        </Box>
      </Stack>
    </Box>
  );
};
