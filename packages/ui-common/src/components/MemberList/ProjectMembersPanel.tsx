import React, { useCallback, useMemo, useState } from "react";
import { Alert, Box, Button, Paper, Stack, Typography } from "@mui/material";
import PeopleIcon from "@mui/icons-material/People";
import { useUsers } from "../../data/hooks";
import {
  DuplicateEmailError,
  useInviteByEmail,
} from "../../data/hooks/useInviteByEmail";
import { useProjectMembers } from "../../data/hooks/useProjectMembers";
import {
  DuplicateMembershipError,
  useAddProjectMember,
} from "../../data/hooks/useAddProjectMember";
import {
  LastProjectOwnerError,
  useRemoveProjectMember,
} from "../../data/hooks/useRemoveProjectMember";
import {
  LastOrganizationOwnerError,
  useRemoveOrganizationMember,
} from "../../data/hooks/useRemoveOrganizationMember";
import type { ProjectRole } from "../../api";
import { usePermissions, useProjectCapabilities } from "../../hooks";
import { CardHeader } from "../CardHeader";
import { MemberList, type MemberRow } from "./MemberList";
import {
  InviteByEmailDialog,
  type InviteByEmailError,
} from "./InviteByEmailDialog";
import {
  AddExistingUserDialog,
  type AddExistingUserError,
} from "./AddExistingUserDialog";
import {
  RemoveMemberDialog,
  type RemoveMemberError,
  type RemoveMemberScope,
} from "./RemoveMemberDialog";

export interface ProjectMembersPanelProps {
  organizationId: string;
  projectId: string;
  onInviteByEmail?: () => void;
  onAddExistingUser?: () => void;
}

export const ProjectMembersPanel: React.FC<ProjectMembersPanelProps> = ({
  organizationId,
  projectId,
  onInviteByEmail,
  onAddExistingUser,
}) => {
  const { inviteToProject, removeMember } = useProjectCapabilities(
    organizationId,
    projectId
  );
  const { removeMembers: canRemoveFromOrganization } = usePermissions();
  const { data: orgMembers, isLoading: orgMembersLoading } =
    useUsers(organizationId);
  const activeOrgMembers = useMemo(
    () => orgMembers.filter((m) => m.isActive),
    [orgMembers]
  );

  const {
    data: projectMembers,
    isLoading: projectMembersLoading,
    isFetching: projectMembersFetching,
    isFetched: projectMembersFetched,
    error: projectMembersError,
    total: projectMembersTotal,
    hasNext: hasMoreProjectMembers,
    fetchNextPage: fetchNextProjectMembersPage,
  } = useProjectMembers(organizationId, projectId);

  const projectMemberIds = useMemo(
    () => new Set(projectMembers.map((m) => m.userId)),
    [projectMembers]
  );

  const addCandidates = useMemo(
    () => activeOrgMembers.filter((m) => !projectMemberIds.has(m.userId)),
    [activeOrgMembers, projectMemberIds]
  );

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteError, setInviteError] = useState<InviteByEmailError | null>(
    null
  );

  const [addExistingOpen, setAddExistingOpen] = useState(false);
  const [addExistingError, setAddExistingError] =
    useState<AddExistingUserError | null>(null);

  const [removingMember, setRemovingMember] = useState<{
    member: MemberRow;
    scope: RemoveMemberScope;
  } | null>(null);
  const [removeError, setRemoveError] = useState<RemoveMemberError | null>(
    null
  );

  const inviteMutation = useInviteByEmail({
    onSuccess: () => {
      setInviteOpen(false);
      setInviteError(null);
    },
    onError: (error) => {
      if (error instanceof DuplicateEmailError) {
        setInviteError({ kind: "duplicate", message: error.message });
      } else {
        setInviteError({
          kind: "generic",
          message: error.message || "Unable to send invite",
        });
      }
    },
  });

  const addProjectMemberMutation = useAddProjectMember({
    onSuccess: () => {
      setAddExistingOpen(false);
      setAddExistingError(null);
    },
    onError: (error) => {
      if (error instanceof DuplicateMembershipError) {
        setAddExistingError({ kind: "duplicate", message: error.message });
      } else {
        setAddExistingError({
          kind: "generic",
          message: error.message || "Unable to add user to project",
        });
      }
    },
  });

  const removeProjectMemberMutation = useRemoveProjectMember({
    onSuccess: () => {
      setRemovingMember(null);
      setRemoveError(null);
    },
    onError: (error) => {
      if (error instanceof LastProjectOwnerError) {
        setRemoveError({ kind: "lastOwner", message: error.message });
      } else {
        setRemoveError({
          kind: "generic",
          message: error.message || "Unable to remove member from project",
        });
      }
    },
  });

  const removeOrganizationMemberMutation = useRemoveOrganizationMember({
    onSuccess: () => {
      setRemovingMember(null);
      setRemoveError(null);
    },
    onError: (error) => {
      if (error instanceof LastOrganizationOwnerError) {
        setRemoveError({ kind: "lastOwner", message: error.message });
      } else {
        setRemoveError({
          kind: "generic",
          message: error.message || "Unable to remove member from organization",
        });
      }
    },
  });

  const handleOpenInvite = useCallback(() => {
    if (onInviteByEmail) {
      onInviteByEmail();
      return;
    }
    setInviteError(null);
    setInviteOpen(true);
  }, [onInviteByEmail]);

  const handleCloseInvite = useCallback(() => {
    setInviteOpen(false);
    setInviteError(null);
  }, []);

  const handleSubmitInvite = useCallback(
    (email: string, role: ProjectRole) => {
      setInviteError(null);
      inviteMutation
        .mutate({
          organizationId,
          projectId,
          email,
          role,
        })
        .catch(() => {
          // onError handler sets UI error state; swallow here to avoid unhandled rejection
        });
    },
    [inviteMutation, organizationId, projectId]
  );

  const handleOpenAddExisting = useCallback(() => {
    if (onAddExistingUser) {
      onAddExistingUser();
      return;
    }
    setAddExistingError(null);
    setAddExistingOpen(true);
  }, [onAddExistingUser]);

  const handleCloseAddExisting = useCallback(() => {
    setAddExistingOpen(false);
    setAddExistingError(null);
  }, []);

  const handleSubmitAddExisting = useCallback(
    (userId: string, role: ProjectRole) => {
      setAddExistingError(null);
      addProjectMemberMutation
        .mutate({
          organizationId,
          projectId,
          userId,
          role,
        })
        .catch(() => {
          // onError handler sets UI error state; swallow here to avoid unhandled rejection
        });
    },
    [addProjectMemberMutation, organizationId, projectId]
  );

  const handleRemoveFromProject = useCallback((member: MemberRow) => {
    setRemoveError(null);
    setRemovingMember({ member, scope: "project" });
  }, []);

  const handleRemoveFromOrganization = useCallback((member: MemberRow) => {
    setRemoveError(null);
    setRemovingMember({ member, scope: "organization" });
  }, []);

  const handleCloseRemove = useCallback(() => {
    setRemovingMember(null);
    setRemoveError(null);
  }, []);

  const handleConfirmRemove = useCallback(() => {
    if (!removingMember) return;
    setRemoveError(null);
    if (removingMember.scope === "project") {
      removeProjectMemberMutation
        .mutate({
          organizationId,
          projectId,
          userId: removingMember.member.userId,
        })
        .catch(() => {
          // onError handler sets UI error state
        });
    } else {
      removeOrganizationMemberMutation
        .mutate({
          organizationId,
          userId: removingMember.member.userId,
        })
        .catch(() => {
          // onError handler sets UI error state
        });
    }
  }, [
    organizationId,
    projectId,
    removingMember,
    removeProjectMemberMutation,
    removeOrganizationMemberMutation,
  ]);

  const removeLoading =
    removeProjectMemberMutation.isPending ||
    removeOrganizationMemberMutation.isPending;

  return (
    <Paper sx={{ p: 2 }} data-testid="project-members-panel">
      <Stack spacing={2}>
        <CardHeader title="Members" icon={PeopleIcon} />
        {!projectMembersError && typeof projectMembersTotal === "number" && (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="project-members-count"
          >
            {projectMembersTotal} member{projectMembersTotal === 1 ? "" : "s"}
          </Typography>
        )}
        {projectMembersError ? (
          <Alert severity="error">Unable to load project members.</Alert>
        ) : (
          <MemberList
            members={projectMembers}
            destination={{ scope: "project", projectId }}
            loading={projectMembersLoading || !projectMembersFetched}
            onInviteByEmail={inviteToProject ? handleOpenInvite : undefined}
            onAddExistingUser={
              inviteToProject ? handleOpenAddExisting : undefined
            }
            onRemoveFromProject={
              removeMember ? handleRemoveFromProject : undefined
            }
            onRemoveFromOrganization={
              canRemoveFromOrganization
                ? handleRemoveFromOrganization
                : undefined
            }
          />
        )}
        {!projectMembersError && hasMoreProjectMembers && (
          <Box>
            <Button
              variant="outlined"
              size="small"
              onClick={fetchNextProjectMembersPage}
              disabled={projectMembersFetching}
              data-testid="project-members-load-more"
            >
              Load more
            </Button>
          </Box>
        )}
      </Stack>
      <InviteByEmailDialog
        open={inviteOpen}
        onClose={handleCloseInvite}
        onSubmit={handleSubmitInvite}
        loading={inviteMutation.isPending}
        error={inviteError}
      />
      <AddExistingUserDialog
        open={addExistingOpen}
        onClose={handleCloseAddExisting}
        onSubmit={handleSubmitAddExisting}
        candidates={addCandidates}
        candidatesLoading={orgMembersLoading || projectMembersLoading}
        loading={addProjectMemberMutation.isPending}
        error={addExistingError}
      />
      <RemoveMemberDialog
        open={Boolean(removingMember)}
        scope={removingMember?.scope ?? "project"}
        memberName={
          removingMember?.member.user?.name ||
          removingMember?.member.user?.email ||
          "this member"
        }
        onClose={handleCloseRemove}
        onConfirm={handleConfirmRemove}
        loading={removeLoading}
        error={removeError}
      />
    </Paper>
  );
};
