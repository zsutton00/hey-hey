import { CapsuleAction } from "@hey-hey/ui-common/components";
import AltRouteIcon from "@mui/icons-material/AltRoute";
import { useNavigate } from "react-router-dom";
import { useCallback } from "react";

interface CreateInitiativePlanActionCapsuleProps {
  organizationId: string;
  projectId: string;
  initiativeId: string;
  initiativeName?: string;
}

// Plans require a Feature parent. The Feature surface owns canonical creation.
export const CreateInitiativePlanActionCapsule = ({
  projectId,
}: CreateInitiativePlanActionCapsuleProps) => {
  const navigate = useNavigate();
  const openFeatures = useCallback(() => {
    void navigate("/projects/" + projectId + "/features");
  }, [navigate, projectId]);
  return (
    <CapsuleAction
      id="create-initiative-plan"
      label="Plan a Feature"
      icon={AltRouteIcon}
      behavior="click"
      actionGroup="page"
      tier="page"
      order={110}
      onClick={openFeatures}
    />
  );
};
