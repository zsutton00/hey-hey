import {
  DemoSandboxProvisionError,
  useDemoSandboxAdmission,
  type DemoSandboxProvisionFailure,
  type DemoSandboxStatusResult,
} from "@hey-hey/ui-common/data";
import type { DemoSandboxSetupProgressDto } from "@hey-hey/ui-common/api";
import { getBotCheckSiteKey } from "@hey-hey/ui-common/services";
import { HeyHeyBranding } from "@hey-hey/ui-common/components";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Checkbox,
  Container,
  FormControlLabel,
  LinearProgress,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { fetchDemoSandboxAvailable } from "../../components/Homepage/landingPageCta";
import { LEGAL_ROUTES } from "../Legal/legalContent";
import { BotCheckWidget } from "./BotCheckWidget";

// Must match the demo document version the API records (DEMO_TERMS_DOCUMENT / DEMO_AGENT_BRIDGE_DOCUMENT).
const DEMO_DOCUMENT_VERSION = "demo-1.0";

type DemoStartView =
  | "checking"
  | "resume-error"
  | "consent"
  // The setup screen while Start's request is still reserving the sandbox.
  | "starting"
  | "setup"
  | "setup-failed"
  | "expired"
  | "unavailable";

const SETUP_STARTED: DemoSandboxSetupProgressDto = {
  stage: "COPYING",
  connectedFeatureCount: 0,
  totalFeatureCount: 0,
};

const projectWelcomePath = (projectId: string): string =>
  `/projects/${projectId}?tab=help&helpSubTab=welcome`;

const isUnavailableFailure = (failure: DemoSandboxProvisionFailure): boolean =>
  failure === "AT_CAPACITY" || failure === "DISABLED";

const DemoShell = ({
  testId,
  children,
}: {
  testId: string;
  children: React.ReactNode;
}) => (
  <Box
    component="main"
    data-testid={testId}
    sx={{ backgroundColor: "background.default", backgroundImage: "none" }}
  >
    <Box
      sx={{
        backgroundColor: "#333",
        color: "white",
        "& .MuiTypography-root": { color: "common.white" },
        px: { xs: 3, sm: 4 },
        py: { xs: 5, sm: 7 },
        textAlign: "center",
      }}
    >
      <HeyHeyBranding variant="hero" />
    </Box>
    <Container maxWidth="sm" sx={{ py: { xs: 4, sm: 6 } }}>
      <Card elevation={3} sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: { xs: 3, sm: 5 } }}>{children}</CardContent>
      </Card>
    </Container>
  </Box>
);

const BackHomeButton = () => {
  const { t } = useTranslation();
  return (
    <Button
      component={RouterLink}
      to="/"
      variant="text"
      data-testid="demo-back-home"
    >
      {t("demo.backHome")}
    </Button>
  );
};

export const DemoStartPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { resume, provision, followSetup } = useDemoSandboxAdmission();
  const [view, setView] = useState<DemoStartView>("checking");
  const [accepted, setAccepted] = useState(false);
  const [botCheckToken, setBotCheckToken] = useState<string | null>(null);
  const [botCheckResetKey, setBotCheckResetKey] = useState(0);
  const [botCheckUnavailable, setBotCheckUnavailable] = useState(false);
  const [progress, setProgress] =
    useState<DemoSandboxSetupProgressDto>(SETUP_STARTED);
  const [setupUnreachable, setSetupUnreachable] = useState(false);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [failure, setFailure] = useState<DemoSandboxProvisionFailure | null>(
    null,
  );
  const siteKey = getBotCheckSiteKey();

  /** Moves the page to whatever the API reports for this browser's demo. */
  const showStatus = useCallback((result: DemoSandboxStatusResult): boolean => {
    if (result.outcome === "ready") {
      // The API has replaced the browser session. Start with fresh auth,
      // organization and query state rather than carrying the prior login
      // through the organization-switch redirect.
      window.location.replace(projectWelcomePath(result.sandbox.projectId));
    } else if (result.outcome === "provisioning") {
      setProgress(result.progress);
      setView("setup");
    } else if (result.outcome === "failed") {
      setView("setup-failed");
    } else if (result.outcome === "expired") {
      setView("expired");
    } else {
      return false;
    }
    return true;
  }, []);

  const checkForExistingDemo = useCallback(
    async (isCancelled: () => boolean): Promise<void> => {
      setView("checking");
      try {
        const result = await resume();
        if (isCancelled()) return;
        if (!showStatus(result)) {
          // A returning browser is always taken back to its demo above; only a
          // visitor who would have to start a new one needs the switch.
          const available = await fetchDemoSandboxAvailable();
          if (!isCancelled()) setView(available ? "consent" : "unavailable");
        }
      } catch {
        if (!isCancelled()) setView("resume-error");
      }
    },
    [resume, showStatus],
  );

  useEffect(() => {
    let cancelled = false;
    void checkForExistingDemo(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [checkForExistingDemo]);

  // While setup runs, keep the screen current until the sandbox is ready or
  // setup failed. A refresh lands back here through the initial check.
  useEffect(() => {
    if (view !== "setup") return;
    const controller = new AbortController();
    setSetupUnreachable(false);
    void followSetup(
      setProgress,
      (reachable) => setSetupUnreachable(!reachable),
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      if (!showStatus(result)) void checkForExistingDemo(() => false);
    });
    return () => controller.abort();
    // setupAttempt restarts following at once when the visitor asks to check again.
  }, [view, setupAttempt, followSetup, showStatus, checkForExistingDemo]);

  const handleRetryCheck = (): void => {
    void checkForExistingDemo(() => false);
  };

  const handleBotCheckToken = useCallback((token: string | null): void => {
    setBotCheckToken(token);
  }, []);

  const handleBotCheckUnavailable = useCallback((): void => {
    setBotCheckUnavailable(true);
  }, []);

  const handleStartNewDemo = async (): Promise<void> => {
    setFailure(null);
    setView((await fetchDemoSandboxAvailable()) ? "consent" : "unavailable");
  };

  const handleStart = async (): Promise<void> => {
    if (!accepted || !botCheckToken) return;
    setFailure(null);
    // The setup screen replaces the form straight away; the request returns
    // as soon as the sandbox is reserved.
    setProgress(SETUP_STARTED);
    setView("starting");
    try {
      const result = await provision({
        botCheckToken,
        demoTermsVersion: DEMO_DOCUMENT_VERSION,
        agentBridgeAcknowledgmentVersion: DEMO_DOCUMENT_VERSION,
      });
      if (!showStatus(result)) setView("consent");
    } catch (error) {
      const reason =
        error instanceof DemoSandboxProvisionError ? error.failure : "UNKNOWN";
      if (isUnavailableFailure(reason)) {
        setView("unavailable");
      } else {
        setFailure(reason);
        setView("consent");
      }
    } finally {
      // Bot-check tokens are single-use, so every attempt needs a new one.
      setBotCheckToken(null);
      setBotCheckResetKey((key) => key + 1);
    }
  };

  const handleLinkClick =
    (path: string) =>
    (event: MouseEvent<HTMLAnchorElement>): void => {
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        navigate(path);
      }
    };

  if (view === "checking") {
    return (
      <DemoShell testId="demo-start-checking">
        <Stack alignItems="center" spacing={2} role="status">
          <CircularProgress aria-hidden />
          <Typography>{t("demo.start.checking")}</Typography>
        </Stack>
      </DemoShell>
    );
  }

  if (view === "resume-error") {
    return (
      <DemoShell testId="demo-start-resume-error">
        <Stack spacing={2} alignItems="flex-start">
          <Alert severity="error" sx={{ width: "100%" }}>
            {t("demo.start.resumeError")}
          </Alert>
          <Button
            variant="contained"
            onClick={handleRetryCheck}
            data-testid="demo-retry-check"
          >
            {t("demo.start.retry")}
          </Button>
        </Stack>
      </DemoShell>
    );
  }

  if (view === "starting" || view === "setup") {
    const connecting = progress.stage === "CONNECTING";
    return (
      <DemoShell testId="demo-setup">
        <Stack spacing={2} role="status" aria-live="polite">
          <Typography component="h1" variant="h4">
            {t("demo.setup.title")}
          </Typography>
          <Typography data-testid="demo-setup-stage">
            {t(`demo.setup.stage.${progress.stage}`)}
          </Typography>
          {connecting && progress.totalFeatureCount > 0 ? (
            <>
              <LinearProgress
                variant="determinate"
                value={
                  (100 * progress.connectedFeatureCount) /
                  progress.totalFeatureCount
                }
              />
              <Typography
                color="text.secondary"
                data-testid="demo-setup-features"
              >
                {t("demo.setup.features", {
                  connected: progress.connectedFeatureCount,
                  total: progress.totalFeatureCount,
                })}
              </Typography>
            </>
          ) : (
            <LinearProgress />
          )}
          <Typography color="text.secondary">{t("demo.setup.note")}</Typography>
          {setupUnreachable && (
            <Alert
              severity="warning"
              data-testid="demo-setup-unreachable"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => setSetupAttempt((attempt) => attempt + 1)}
                  data-testid="demo-setup-check-again"
                >
                  {t("demo.setup.checkAgain")}
                </Button>
              }
            >
              {t("demo.setup.unreachable")}
            </Alert>
          )}
        </Stack>
      </DemoShell>
    );
  }

  if (view === "setup-failed") {
    return (
      <DemoShell testId="demo-setup-failed">
        <Stack spacing={2}>
          <Typography component="h1" variant="h4">
            {t("demo.setup.failed.title")}
          </Typography>
          <Alert severity="error">{t("demo.setup.failed.body")}</Alert>
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              onClick={() => void handleStartNewDemo()}
              data-testid="demo-setup-retry"
            >
              {t("demo.setup.failed.retry")}
            </Button>
            <BackHomeButton />
          </Stack>
        </Stack>
      </DemoShell>
    );
  }

  if (view === "expired") {
    return (
      <DemoShell testId="demo-expired-page">
        <Stack spacing={2}>
          <Typography component="h1" variant="h4">
            {t("demo.expired.title")}
          </Typography>
          <Typography>{t("demo.expired.body")}</Typography>
          <Typography color="text.secondary">
            {t("demo.expired.note")}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              onClick={() => void handleStartNewDemo()}
              data-testid="demo-start-new"
            >
              {t("demo.expired.startNew")}
            </Button>
            <BackHomeButton />
          </Stack>
        </Stack>
      </DemoShell>
    );
  }

  if (view === "unavailable") {
    return (
      <DemoShell testId="demo-unavailable-page">
        <Stack spacing={2}>
          <Typography component="h1" variant="h4">
            {t("demo.unavailable.title")}
          </Typography>
          <Typography>{t("demo.unavailable.body")}</Typography>
          <Typography color="text.secondary">
            {t("demo.unavailable.alternative")}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              component="a"
              href="/request-access"
              variant="contained"
              onClick={handleLinkClick("/request-access")}
              data-testid="demo-request-beta-access"
            >
              {t("demo.unavailable.requestAccess")}
            </Button>
            <BackHomeButton />
          </Stack>
        </Stack>
      </DemoShell>
    );
  }

  const canStart = accepted && botCheckToken !== null && !botCheckUnavailable;

  return (
    <DemoShell testId="demo-consent">
      <Stack spacing={3}>
        <Typography component="h1" variant="h4">
          {t("demo.consent.title")}
        </Typography>
        <Stack spacing={1}>
          <Typography>{t("demo.consent.intro")}</Typography>
          <Typography>{t("demo.consent.inactivity")}</Typography>
          <Typography>{t("demo.consent.agents")}</Typography>
        </Stack>
        <FormControlLabel
          control={
            <Checkbox
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              slotProps={{
                input: { "data-testid": "demo-accept-checkbox" } as Record<
                  string,
                  string
                >,
              }}
            />
          }
          label={
            <Trans
              i18nKey="demo.consent.accept"
              components={{
                terms: (
                  <Link
                    component={RouterLink}
                    to={LEGAL_ROUTES.terms}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                ),
                agentBridge: (
                  <Link
                    component={RouterLink}
                    to={LEGAL_ROUTES.security}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                ),
              }}
            />
          }
        />
        <Box aria-label={t("demo.consent.botCheck")} role="group">
          {siteKey && !botCheckUnavailable ? (
            <BotCheckWidget
              siteKey={siteKey}
              onToken={handleBotCheckToken}
              onUnavailable={handleBotCheckUnavailable}
              resetKey={botCheckResetKey}
            />
          ) : (
            <Alert severity="warning" data-testid="demo-bot-check-unavailable">
              {t("demo.consent.botCheckUnavailable")}
            </Alert>
          )}
        </Box>
        {failure && (
          <Alert severity="error" data-testid="demo-start-error">
            {t(`demo.consent.error.${failure}`)}
          </Alert>
        )}
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="contained"
            disabled={!canStart}
            onClick={() => {
              void handleStart();
            }}
            data-testid="demo-start-button"
          >
            {t("demo.consent.start")}
          </Button>
          <BackHomeButton />
        </Stack>
      </Stack>
    </DemoShell>
  );
};

export default DemoStartPage;
