import React from "react";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { useParams } from "react-router-dom";
import { InitiativePage } from "./InitiativePage";

export const InitiativeDetailPage: React.FC = () => {
  const { projectId = "", initiativeId = "" } = useParams<{
    projectId: string;
    initiativeId: string;
  }>();
  const organizationId = useUserIdentity()?.currentOrgId ?? "";

  return (
    <InitiativePage
      organizationId={organizationId}
      projectId={projectId}
      initiativeId={initiativeId}
    />
  );
};
