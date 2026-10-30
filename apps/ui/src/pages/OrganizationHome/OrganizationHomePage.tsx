import { useModalState } from "@hey-hey/ui-common/components/Modals";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import { OrganizationHome } from "@hey-hey/ui-common/components";
import { useAuth, useOrganization } from "@hey-hey/ui-common/context";
import { usePermissions, useUserIdentity } from "@hey-hey/ui-common/hooks";
import {
  useAccountDefaultOrganization,
  useProjects,
} from "@hey-hey/ui-common/data";
import {
  Alert,
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { Navigate, useNavigate } from "react-router-dom";
import { useCallback, useState } from "react";
import { useShouldShowNewOrgIntro } from "../../hooks/useShouldShowNewOrgIntro";

export const OrganizationHomePage = () => {
  const { isAuthenticated, loading: authLoading, logout, user } = useAuth();
  const {
    currentOrganization,
    organizations,
    switchOrganization,
    loading: organizationLoading,
    error: organizationError,
  } = useOrganization();
  const identity = useUserIdentity();
  const { createProjects: canCreateProjects } = usePermissions();
  const defaultOrganization = useAccountDefaultOrganization(identity?.userId);
  const { create: createProject } = useProjects(currentOrganization?.id, {
    enabled: Boolean(currentOrganization?.id),
  });
  const navigate = useNavigate();
  const [createDialogOpen, setCreateDialogOpen, createDialogOpenOwnerKey] =
    useModalState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const handleMetricActivate = useCallback(
    (path: string) => navigate(path),
    [navigate],
  );
  const handleLogout = useCallback(async () => {
    await logout();
    navigate("/");
  }, [logout, navigate]);
  const handleCreateProject = useCallback(() => setCreateDialogOpen(true), []);
  const handleCloseCreateDialog = useCallback(() => {
    if (creatingProject) return;
    setCreateDialogOpen(false);
    setProjectName("");
    setProjectDescription("");
  }, [creatingProject]);
  const handleCreateProjectSubmit = useCallback(async () => {
    if (!projectName.trim() || creatingProject) return;

    setCreatingProject(true);
    try {
      await createProject(
        {
          name: projectName.trim(),
          description: projectDescription.trim() || null,
        },
        {
          onSuccess: () => {
            setCreateDialogOpen(false);
            setProjectName("");
            setProjectDescription("");
          },
        },
      );
    } finally {
      setCreatingProject(false);
    }
  }, [createProject, creatingProject, projectDescription, projectName]);
  const { isReady: introReady, shouldShow: shouldShowNewOrgIntro } =
    useShouldShowNewOrgIntro();

  if (introReady && shouldShowNewOrgIntro) {
    return <Navigate to="/welcome" replace />;
  }

  if (organizationError && !organizationLoading) {
    return (
      <Box
        component="main"
        data-testid="organization-home-context-error"
        sx={{ p: 3 }}
      >
        <Alert severity="error">Unable to load your organization.</Alert>
      </Box>
    );
  }

  if (
    authLoading ||
    !isAuthenticated ||
    organizationLoading ||
    !currentOrganization ||
    !identity ||
    !user
  ) {
    return (
      <OrganizationHome
        header={null}
        onMetricActivate={handleMetricActivate}
        onCreateProject={handleCreateProject}
        organizationId={undefined}
      />
    );
  }

  if (user.name === undefined) {
    return (
      <Box
        component="main"
        data-testid="organization-home-profile-error"
        sx={{ p: 3 }}
      >
        <Alert severity="error">Unable to load your profile.</Alert>
      </Box>
    );
  }

  return (
    <>
      <OrganizationHome
        header={{
          userName: user.name,
          organization: currentOrganization,
          organizations,
          defaultState: defaultOrganization.state,
          onOrganizationChange: switchOrganization,
          onSetDefault: defaultOrganization.save,
          onRetryDefault: defaultOrganization.reload,
          onLogout: handleLogout,
        }}
        key={currentOrganization.id}
        organizationId={currentOrganization.id}
        currentUserId={identity.userId}
        onMetricActivate={handleMetricActivate}
        onCreateProject={handleCreateProject}
      />
      {canCreateProjects ? (
        <Dialog
          ownerKey={createDialogOpenOwnerKey}
          open={createDialogOpen}
          onClose={handleCloseCreateDialog}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Create New Project</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              required
              margin="dense"
              label="Project Name"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              fullWidth
            />
            <TextField
              margin="dense"
              label="Description (Optional)"
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
              multiline
              rows={3}
              fullWidth
            />
          </DialogContent>
          <DialogActions>
            <Button
              onClick={handleCloseCreateDialog}
              disabled={creatingProject}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreateProjectSubmit()}
              disabled={!projectName.trim() || creatingProject}
              variant="contained"
            >
              {creatingProject ? "Creating…" : "Create"}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </>
  );
};

export default OrganizationHomePage;
