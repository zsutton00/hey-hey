import { WebPathService } from "@hey-hey/ui-common/services";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button as ChangesLinkButton } from "@mui/material";
import React from "react";
import { DataStateLoadingProvider } from "@hey-hey/ui-common/components";
import { useParams } from "react-router-dom";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { AgentSessionContent } from "./AgentSessionContent";

export const AgentSessionPage: React.FC = () => {
  const { t } = useTranslation();
  const { projectId, agentSessionId } = useParams<{
    projectId: string;
    agentSessionId: string;
  }>();
  const organizationId = useUserIdentity()?.currentOrgId ?? "";

  return (
    <DataStateLoadingProvider>
      <ChangesLinkButton
        component={RouterLink}
        to={WebPathService.projectChanges(projectId ?? "", {
          agentSessionId: agentSessionId ?? "",
        })}
        data-testid="open-changes"
      >
        {t("changes.title")}
      </ChangesLinkButton>
      <AgentSessionContent
        organizationId={organizationId}
        projectId={projectId ?? ""}
        agentSessionId={agentSessionId ?? ""}
      />
    </DataStateLoadingProvider>
  );
};
