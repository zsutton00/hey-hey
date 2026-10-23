import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { Alert, Box } from "@mui/material";
import React from "react";
import { useParams } from "react-router-dom";
import { ProposalGroupDetailView } from "./ProposalGroupDetailView";

const ProposalGroupDetailPage: React.FC = () => {
  const { projectId, groupId } = useParams<{
    projectId: string;
    groupId: string;
  }>();
  const { currentOrgId } = useUserIdentity() || {};

  if (!currentOrgId || !projectId || !groupId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Missing required parameters.</Alert>
      </Box>
    );
  }

  return (
    <ProposalGroupDetailView
      organizationId={currentOrgId}
      projectId={projectId}
      groupId={groupId}
    />
  );
};

ProposalGroupDetailPage.displayName = "ProposalGroupDetailPage";

export { ProposalGroupDetailPage };
