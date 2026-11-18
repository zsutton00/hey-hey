import { useMemo, type ReactNode } from "react";
import { Box } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import {
  BrandedAppearanceProvider,
  BrandedWordmark,
} from "@hey-hey/ui-common/components";
import { createHeyTheme } from "@hey-hey/ui-common/context";

/** The branded frame is always dark, whatever mode the rest of the app is in. */
const BRANDED_THEME_MODE = "dark";

/** Conversation content sits at most this wide, centred under the headline. */
const ONBOARDING_CONTENT_MAX_WIDTH = "1100px";

/**
 * The one onboarding page look, shared by hosted and local onboarding. It is
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
  const brandedTheme = useMemo(() => createHeyTheme(BRANDED_THEME_MODE), []);

  return (
    <ThemeProvider theme={brandedTheme}>
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
            color: "#fff",
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
    </ThemeProvider>
  );
}
