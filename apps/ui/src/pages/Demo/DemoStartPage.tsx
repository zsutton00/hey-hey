import {
  DemoSandboxProvisionError,
  useDemoSandboxAdmission,
  type DemoSandboxProvisionFailure,
} from "@hey-hey/ui-common/data";
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
  "checking" | "resume-error" | "consent" | "expired" | "unavailable";

const projectPath = (projectId: string): string => `/projects/${projectId}`;

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
  const { resume, provision } = useDemoSandboxAdmission();
  const [view, setView] = useState<DemoStartView>("checking");
  const [accepted, setAccepted] = useState(false);
  const [botCheckToken, setBotCheckToken] = useState<string | null>(null);
  const [botCheckResetKey, setBotCheckResetKey] = useState(0);
  const [botCheckUnavailable, setBotCheckUnavailable] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [failure, setFailure] = useState<DemoSandboxProvisionFailure | null>(
    null,
  );
  const siteKey = getBotCheckSiteKey();

  const checkForExistingDemo = useCallback(
    async (isCancelled: () => boolean): Promise<void> => {
      setView("checking");
      try {
        const result = await resume();
        if (isCancelled()) return;
        if (result.outcome === "resumed") {
          navigate(projectPath(result.sandbox.projectId), { replace: true });
        } else if (result.outcome === "expired") {
          setView("expired");
        } else {
          // A returning browser is always taken back to its demo above; only a
          // visitor who would have to start a new one needs the switch.
          const available = await fetchDemoSandboxAvailable();
          if (!isCancelled()) setView(available ? "consent" : "unavailable");
        }
      } catch {
        if (!isCancelled()) setView("resume-error");
      }
    },
    [navigate, resume],
  );

  useEffect(() => {
    let cancelled = false;
    void checkForExistingDemo(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [checkForExistingDemo]);

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
    if (!accepted || !botCheckToken || isStarting) return;
    setIsStarting(true);
    setFailure(null);
    try {
      const sandbox = await provision({
        botCheckToken,
        demoTermsVersion: DEMO_DOCUMENT_VERSION,
        agentBridgeAcknowledgmentVersion: DEMO_DOCUMENT_VERSION,
      });
      navigate(projectPath(sandbox.projectId), { replace: true });
    } catch (error) {
      const reason =
        error instanceof DemoSandboxProvisionError ? error.failure : "UNKNOWN";
      if (isUnavailableFailure(reason)) {
        setView("unavailable");
      } else {
        setFailure(reason);
      }
      // Bot-check tokens are single-use, so every failed attempt needs a new one.
      setBotCheckToken(null);
      setBotCheckResetKey((key) => key + 1);
      setIsStarting(false);
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

  const canStart =
    accepted && botCheckToken !== null && !isStarting && !botCheckUnavailable;

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
            {isStarting ? t("demo.consent.starting") : t("demo.consent.start")}
          </Button>
          <BackHomeButton />
        </Stack>
      </Stack>
    </DemoShell>
  );
};

export default DemoStartPage;
