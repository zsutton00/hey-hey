import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { Alert, Box } from "@mui/material";
import React, { useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ProposalDetailView } from "./ProposalDetailView";
import { normalizeProposalReturnTarget } from "./proposalReturnTarget";

const ProposalDetailPage: React.FC = () => {
  const { projectId, proposalId } = useParams<{
    projectId: string;
    proposalId: string;
  }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = useMemo(
    () => normalizeProposalReturnTarget(searchParams.get("returnTo")),
    [searchParams],
  );
  const handleApplied = useCallback(() => {
    if (returnTo) navigate(returnTo, { replace: true });
  }, [navigate, returnTo]);
  const { currentOrgId } = useUserIdentity() || {};

  if (!currentOrgId || !projectId || !proposalId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Missing required parameters.</Alert>
      </Box>
    );
  }

  return (
    <ProposalDetailView
      proposalId={proposalId}
      organizationId={currentOrgId}
      projectId={projectId}
      onApplied={returnTo ? handleApplied : undefined}
    />
  );
};

ProposalDetailPage.displayName = "ProposalDetailPage";

export { ProposalDetailPage };
