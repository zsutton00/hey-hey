import type { ReactNode } from "react";
import { Box } from "@mui/material";
import {
  BrandedAppearanceProvider,
  BrandedWordmark,
} from "@hey-hey/ui-common/components";

/** Conversation content sits at most this wide, centred under the headline. */
const ONBOARDING_CONTENT_MAX_WIDTH = "1100px";

/**
 * The one onboarding page look (light or dark, following the app theme), shared by hosted and local onboarding. It is
 * purely presentational: each page supplies its own content and behavior.
 * `header` renders above the wordmark.
 */
export function OnboardingFrame({
  header,
  children,
}: {
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <BrandedAppearanceProvider value>
      <Box
        data-testid="onboarding-frame"
        sx={{
          minHeight: "100vh",
          boxSizing: "border-box",
          px: { xs: 2, md: 4 },
          pt: "clamp(2rem, 5vw, 3.5rem)",
          pb: 8,
          bgcolor: "background.default",
          color: "text.primary",
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        }}
      >
        {header}
        <Box sx={{ textAlign: "center" }}>
          <BrandedWordmark>HEY HEY</BrandedWordmark>
        </Box>

        <Box sx={{ maxWidth: ONBOARDING_CONTENT_MAX_WIDTH, mx: "auto" }}>
          {children}
        </Box>
      </Box>
    </BrandedAppearanceProvider>
  );
}
