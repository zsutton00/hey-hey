import { useMemo } from "react";
import { Alert, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { Navigate, useSearchParams } from "react-router-dom";
import { useOrganization } from "@hey-hey/ui-common/context";
import {
  useConversationByWorkflow,
  useProjects,
} from "@hey-hey/ui-common/data";
import { ConversationStatus, ProjectStatus } from "@hey-hey/ui-common/api";

import { LocalOnboardingStart } from "./LocalOnboardingStart";
import { WelcomeSteps } from "./WelcomeSteps";

const ONBOARDING_STATUSES = Object.values(ConversationStatus);

/**
 * Local `/welcome`: explains onboarding and starts it for the project created
 * when the name was saved. It never creates a project.
 */
export function LocalWelcome() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { currentOrganization } = useOrganization();
  const organizationId = currentOrganization?.id;

  const projects = useProjects(organizationId, { enabled: !!organizationId });
  const requestedProjectId = searchParams.get("projectId");
  const project = requestedProjectId
    ? projects.projects.find((item) => item.id === requestedProjectId)
    : projects.projects.find(
        (item) => item.status === ProjectStatus.Onboarding,
      );
  const conversation = useConversationByWorkflow(
    organizationId,
    project?.id,
    "onboarding",
    {
      enabled: project?.status === ProjectStatus.Onboarding,
      workflowAboutId: project?.id,
      workflowAboutType: "project",
      statuses: ONBOARDING_STATUSES,
    },
  );

  const conversationId = conversation.data?.id;
  const workflowId = conversation.data?.workflowId;
  const target = useMemo(
    () =>
      project && conversationId && workflowId
        ? {
            organizationId: project.organizationId,
            projectId: project.id,
            conversationId,
            workflowId,
          }
        : null,
    [project, conversationId, workflowId],
  );

  const hasNoSetupProject =
    !requestedProjectId &&
    projects.isReady &&
    projects.projects.length > 0 &&
    !project;
  if (project?.status === ProjectStatus.Active || hasNoSetupProject) {
    return <Navigate to="/projects" replace />;
  }

  const failure = projects.error ?? conversation.error?.message;

  return (
    <Stack
      data-testid="local-onboarding-welcome"
      alignItems="center"
      sx={{ px: { xs: 2, sm: 4 }, py: 6 }}
    >
      <WelcomeSteps
        cta={
          <Stack spacing={2} sx={{ width: "100%", maxWidth: 720 }}>
            <Typography
              data-testid="onboarding-model-guidance"
              color="text.secondary"
            >
              {t("onboarding.runtime.ownPlanGuidance")}
            </Typography>
            {failure && <Alert severity="error">{failure}</Alert>}
            {projects.isReady && !project ? (
              <Alert severity="error">
                {t("onboarding.runtime.projectUnavailable")}
              </Alert>
            ) : target ? (
              <LocalOnboardingStart target={target} />
            ) : (
              !failure && (
                <Typography role="status">
                  {t("onboarding.runtime.loading")}
                </Typography>
              )
            )}
          </Stack>
        }
      />
    </Stack>
  );
}
