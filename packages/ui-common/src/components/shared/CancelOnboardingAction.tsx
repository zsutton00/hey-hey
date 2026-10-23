import { Alert, Button, Stack } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { platformClient } from "../../clients/serviceClients";
import { removeCachedProject } from "../../data/collections/projects";
import { WebPathService } from "../../services";

interface CancelOnboardingActionProps {
  organizationId: string;
  projectId: string;
}

export const CancelOnboardingAction = ({
  organizationId,
  projectId,
}: CancelOnboardingActionProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const [hasError, setHasError] = useState(false);

  const cancel = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsPending(true);
    setHasError(false);
    try {
      await platformClient.removeProject({ organizationId, projectId });
    } catch {
      inFlight.current = false;
      setIsPending(false);
      setHasError(true);
      return;
    }
    // Commit only after deletion succeeds, including detail-only cached projects.
    removeCachedProject(queryClient, organizationId, projectId);
    navigate(WebPathService.projects(), { replace: true });
  };

  return (
    <Stack spacing={1} alignItems="flex-end">
      <Button
        data-testid="project-cancel-onboarding"
        color="error"
        disabled={isPending}
        aria-busy={isPending}
        onClick={cancel}
      >
        {isPending ? "Cancelling Onboarding…" : "Cancel Onboarding"}
      </Button>
      {hasError && (
        <Alert severity="error">
          Unable to cancel onboarding. Please try again.
        </Alert>
      )}
    </Stack>
  );
};
