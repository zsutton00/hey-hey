import { Box, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDemoSandbox } from "../../data/hooks/useDemoSandbox";

export interface DemoSandboxBannerProps {
  /** Turn the sandbox lookup off for signed-out visitors. */
  enabled?: boolean;
}

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/**
 * Persistent notice for demo visitors. It renders nothing for anyone who is not
 * in a sandbox. The countdown uses the API-reported expiry; local ticks only refresh
 * the display and never extend the sandbox.
 */
export const DemoSandboxBanner = ({
  enabled = true,
}: DemoSandboxBannerProps) => {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  const { sandbox } = useDemoSandbox({
    enabled,
    poll: true,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!sandbox) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [sandbox]);

  if (!sandbox) {
    return null;
  }

  const timeoutSeconds = sandbox.inactivityTimeoutSeconds;
  const duration =
    timeoutSeconds % SECONDS_PER_HOUR === 0
      ? t("demo.banner.timeoutHours", {
          count: timeoutSeconds / SECONDS_PER_HOUR,
        })
      : t("demo.banner.timeoutMinutes", {
          count: Math.round(timeoutSeconds / SECONDS_PER_MINUTE),
        });
  const remainingMinutes = Math.max(
    0,
    Math.ceil((new Date(sandbox.expiresAt).getTime() - now) / 60_000),
  );
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  const time =
    hours > 0
      ? t("demo.banner.remainingHours", { hours, minutes })
      : t("demo.banner.remainingMinutes", { minutes });

  return (
    <Box
      component="aside"
      data-testid="demo-sandbox-banner"
      sx={{
        flexShrink: 0,
        px: 2,
        py: 0.75,
        bgcolor: "background.paper",
        borderTop: 1,
        borderColor: "divider",
        textAlign: "center",
      }}
    >
      <Typography variant="caption" component="p" color="text.secondary">
        {t("demo.banner.title")} · {t("demo.banner.policy", { duration })} ·{" "}
        {time}
      </Typography>
    </Box>
  );
};
