import { TaskPage } from "../Task/TaskPage";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { Alert } from "@mui/material";
import { useParams } from "react-router-dom";

// Step routes carry the canonical implementation Task identity after cutover.
export const PlanStepPage = () => {
  const { projectId, stepId } = useParams<{
    projectId: string;
    stepId: string;
  }>();
  const organizationId = useUserIdentity()?.currentOrgId;
  if (!organizationId || !projectId || !stepId)
    return <Alert severity="error">Missing step route context.</Alert>;
  return (
    <TaskPage
      organizationId={organizationId}
      projectId={projectId}
      taskId={stepId}
    />
  );
};
