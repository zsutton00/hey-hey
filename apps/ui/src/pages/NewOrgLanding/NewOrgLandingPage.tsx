import { useCallback, useState } from "react";
import { Alert, Box, Button, Stack } from "@mui/material";
import { Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQueryState, parseAsBoolean } from "nuqs";

import { TrackingProvider, useOrganization } from "@hey-hey/ui-common/context";
import { usePermissions } from "@hey-hey/ui-common/hooks";
import { useProjects } from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common/services";

import { useShouldShowNewOrgIntro } from "../../hooks/useShouldShowNewOrgIntro";
import { OrientationContent } from "./OrientationContent";

const PROJECT_PICKER_PATH = "/projects";

const NewOrgLandingPageContent: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isReady, shouldShow, markSeen } = useShouldShowNewOrgIntro();
  // Debug escape hatch: `?forceShow=true` keeps the page rendered even when the
  // intro gate (org already has projects / intro already seen) would redirect.
  const [forceShow] = useQueryState(
    "forceShow",
    parseAsBoolean.withDefault(false),
  );
  const { currentOrganization } = useOrganization();
  const { createProjects: canCreateProjects } = usePermissions();
  const { create, error, entitlement, entitlementLoading } = useProjects(
    currentOrganization?.id,
    {
      enabled: !!currentOrganization?.id,
    },
  );
  const [isCreating, setIsCreating] = useState(false);

  const handleStart = useCallback(async () => {
    if (isCreating) return;
    setIsCreating(true);
    markSeen();

    // Stand up a placeholder project so the onboarding intake has something
    // to attach to; the user names and describes it during onboarding itself.
    const created = await create(
      {
        name: t("newOrgLanding.advance.defaultProjectName", "My First Project"),
        description: null,
      },
      {
        skipNavigation: true,
        onSuccess: (project) => {
          navigate(
            WebPathService.onboarding({
              projectId: project.id,
              isNew: true,
            }),
          );
        },
      },
    );

    // On failure the user stays on this page with the error surfaced below the
    // button; re-enable it so they can retry rather than getting stranded.
    if (!created) {
      setIsCreating(false);
    }
  }, [isCreating, markSeen, create, t, navigate]);

  if (!isReady) {
    return null;
  }

  // Suppress the intro-gate redirect once the user has clicked Start.
  // handleStart navigates to onboarding, but the route-transition
  // <AnimatePresence> keeps this page briefly mounted; it then re-renders with
  // `forceShow` gone from the URL and `shouldShow` now false (a project was
  // just created), so without the `isCreating` check it would fire
  // <Navigate to="/projects"> and clobber the onboarding navigation.
  if (!shouldShow && !forceShow && !isCreating) {
    return <Navigate to={PROJECT_PICKER_PATH} replace />;
  }

  return (
    <Box
      data-testid="new-org-landing-page"
      sx={{
        minHeight: "calc(100vh - 64px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: { xs: 2, sm: 4 },
        py: 6,
      }}
    >
      <OrientationContent
        cta={
          <Stack spacing={2} alignItems="center" sx={{ width: "100%" }}>
            {error && (
              <Alert
                severity="error"
                data-testid="new-org-landing-error"
                sx={{ width: "100%", maxWidth: 560 }}
              >
                {error}
              </Alert>
            )}
            {canCreateProjects &&
              entitlement &&
              !entitlement.canCreateProject && (
                <Alert
                  severity="info"
                  data-testid="new-org-project-limit-message"
                  sx={{ width: "100%", maxWidth: 560 }}
                >
                  {entitlement.creationUnavailableReason}
                </Alert>
              )}
            {canCreateProjects ? (
              <Button
                variant="contained"
                size="large"
                onClick={handleStart}
                disabled={
                  isCreating ||
                  entitlementLoading ||
                  !entitlement?.canCreateProject
                }
                data-testid="new-org-landing-advance"
                sx={{ px: 6, py: 1.75, fontSize: "1.125rem" }}
              >
                {t(
                  "newOrgLanding.advance.start",
                  "Start setting up your project",
                )}
              </Button>
            ) : (
              <Alert
                severity="info"
                data-testid="new-org-landing-create-unavailable"
                sx={{ width: "100%", maxWidth: 560 }}
              >
                {t(
                  "newOrgLanding.advance.ownerOrAdminRequired",
                  "An organization owner or admin needs to create the first project.",
                )}
              </Alert>
            )}
          </Stack>
        }
      />
    </Box>
  );
};

const NewOrgLandingPage: React.FC = () => (
  <TrackingProvider
    context={{
      page: {
        name: "new-org-landing",
        path: window.location.pathname,
        section: "welcome",
      },
    }}
    enabled={true}
  >
    <NewOrgLandingPageContent />
  </TrackingProvider>
);

export default NewOrgLandingPage;
