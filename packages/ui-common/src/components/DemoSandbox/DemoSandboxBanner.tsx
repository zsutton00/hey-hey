import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Alert, Box, IconButton, Link, Stack, Tooltip, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { useDemoSandbox } from "../../data/hooks/useDemoSandbox";

export const DEMO_PAIRING_PATH = "/pairing";

export interface DemoSandboxBannerProps {
  /** Turn the sandbox lookup off for signed-out visitors. */
  enabled?: boolean;
}

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/**
 * Persistent notice for demo visitors. It renders nothing for anyone who is not
 * in a sandbox. Expiry and the inactivity timeout are shown exactly as the API
 * reports them and are never derived locally.
 */
export const DemoSandboxBanner = ({ enabled = true }: DemoSandboxBannerProps) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const { sandbox } = useDemoSandbox({
    enabled,
    poll: true,
    refetchOnWindowFocus: true,
  });

  if (!sandbox) return null;

  const timeoutSeconds = sandbox.inactivityTimeoutSeconds;
  const duration =
    timeoutSeconds % SECONDS_PER_HOUR === 0
      ? t("demo.banner.timeoutHours", { count: timeoutSeconds / SECONDS_PER_HOUR })
      : t("demo.banner.timeoutMinutes", {
          count: Math.round(timeoutSeconds / SECONDS_PER_MINUTE),
        });
  const expiry = new Date(sandbox.expiresAt).toLocaleString();
  const cloneCommand = `git clone ${sandbox.repositoryUrl}`;

  const handleCopyClone = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(cloneCommand);
      setCopied(true);
    } catch (error) {
      console.error("Failed to copy clone command to clipboard:", error);
    }
  };

  return (
    <Alert
      severity="info"
      icon={false}
      data-testid="demo-sandbox-banner"
      sx={{ borderRadius: 0, alignItems: "center" }}
    >
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={{ xs: 1, md: 3 }}
        alignItems={{ md: "center" }}
        flexWrap="wrap"
      >
        <Box>
          <Typography variant="subtitle2" component="p">
            {t("demo.banner.title")}
          </Typography>
          <Typography variant="body2" data-testid="demo-sandbox-policy">
            {t("demo.banner.policy", { duration })}
          </Typography>
          <Typography variant="body2" data-testid="demo-sandbox-expiry">
            {t("demo.banner.expiry", { time: expiry })}
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <Link
            component={RouterLink}
            to={DEMO_PAIRING_PATH}
            data-testid="demo-sandbox-pair-link"
          >
            {t("demo.banner.pairCli")}
          </Link>
          <Link
            href={sandbox.repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="demo-sandbox-repository-link"
          >
            {t("demo.banner.repository")}
          </Link>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Box
              component="code"
              aria-label={t("demo.banner.cloneLabel")}
              data-testid="demo-sandbox-clone-command"
              sx={{ fontFamily: "monospace", fontSize: "0.8125rem" }}
            >
              {cloneCommand}
            </Box>
            <Tooltip title={copied ? t("demo.banner.copied") : t("demo.banner.copyClone")}>
              <IconButton
                size="small"
                aria-label={t("demo.banner.copyClone")}
                data-testid="demo-sandbox-copy-clone"
                onClick={() => {
                  void handleCopyClone();
                }}
              >
                <ContentCopyIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </Stack>
    </Alert>
  );
};
