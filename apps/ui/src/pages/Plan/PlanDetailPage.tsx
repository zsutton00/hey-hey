import React from "react";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { useParams } from "react-router-dom";
import { PlanPage } from "./PlanPage";

export const PlanDetailPage: React.FC = () => {
  const { projectId = "", planId = "", stageId } = useParams<{
    projectId: string;
    planId: string;
    stageId?: string;
  }>();
  const organizationId = useUserIdentity()?.currentOrgId ?? "";

  return (
    <PlanPage
      organizationId={organizationId}
      projectId={projectId}
      planId={planId}
      stageId={stageId}
    />
  );
};
