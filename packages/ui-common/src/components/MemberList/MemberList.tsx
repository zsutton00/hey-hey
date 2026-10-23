import React, { useCallback, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Avatar,
  Box,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import { usePathService } from "../../contexts";

export interface MemberRow {
  id: string;
  userId: string;
  role: string;
  user?: { name?: string; email?: string };
}

export type MemberUserDestination =
  | { scope: "organization"; organizationId: string }
  | { scope: "project"; projectId: string };

export interface MemberListProps {
  members: MemberRow[];
  destination: MemberUserDestination;
  loading?: boolean;
  emptyMessage?: string;
  onInviteByEmail?: () => void;
  onAddExistingUser?: () => void;
  onRemoveFromProject?: (member: MemberRow) => void;
  onRemoveFromOrganization?: (member: MemberRow) => void;
}

const getInitials = (
  name: string | undefined,
  email: string | undefined
): string => {
  const source = name?.trim() || email?.trim() || "";
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
};

interface MemberRowMenuProps {
  member: MemberRow;
  onRemoveFromProject?: (member: MemberRow) => void;
  onRemoveFromOrganization?: (member: MemberRow) => void;
}

const MemberRowMenu: React.FC<MemberRowMenuProps> = ({
  member,
  onRemoveFromProject,
  onRemoveFromOrganization,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleOpen = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setAnchorEl(event.currentTarget);
    },
    []
  );

  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handleRemoveFromProject = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setAnchorEl(null);
      onRemoveFromProject?.(member);
    },
    [member, onRemoveFromProject]
  );

  const handleRemoveFromOrganization = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setAnchorEl(null);
      onRemoveFromOrganization?.(member);
    },
    [member, onRemoveFromOrganization]
  );

  if (!onRemoveFromProject && !onRemoveFromOrganization) {
    return null;
  }

  return (
    <>
      <IconButton
        size="small"
        aria-label="member actions"
        onClick={handleOpen}
        data-testid={`member-row-menu-${member.userId}`}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={open} onClose={handleClose}>
        {onRemoveFromProject && (
          <MenuItem
            onClick={handleRemoveFromProject}
            data-testid={`member-row-remove-project-${member.userId}`}
          >
            Remove from project
          </MenuItem>
        )}
        {onRemoveFromOrganization && (
          <MenuItem
            onClick={handleRemoveFromOrganization}
            data-testid={`member-row-remove-organization-${member.userId}`}
          >
            Remove from organization
          </MenuItem>
        )}
      </Menu>
    </>
  );
};

export const MemberList: React.FC<MemberListProps> = ({
  members,
  destination,
  loading = false,
  emptyMessage = "No members yet",
  onInviteByEmail,
  onAddExistingUser,
  onRemoveFromProject,
  onRemoveFromOrganization,
}) => {
  const pathService = usePathService();

  return (
    <Box data-testid="member-list" sx={{ width: "100%" }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="flex-end"
        spacing={1}
        sx={{ mb: 1 }}
      >
        {onAddExistingUser && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<GroupAddIcon />}
            onClick={onAddExistingUser}
            data-testid="member-list-add-existing"
          >
            Add existing user
          </Button>
        )}
        {onInviteByEmail && (
          <Button
            size="small"
            variant="contained"
            startIcon={<PersonAddIcon />}
            onClick={onInviteByEmail}
            data-testid="member-list-invite"
          >
            Invite by email
          </Button>
        )}
      </Stack>

      {loading ? (
        <Stack spacing={1}>
          {[0, 1, 2].map((i) => (
            <Skeleton
              key={i}
              variant="rectangular"
              height={64}
              sx={{ borderRadius: 0.5 }}
            />
          ))}
        </Stack>
      ) : members.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            {emptyMessage}
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1}>
          {members.map((member) => {
            const user = member.user;
            const name = user?.name || "Unknown user";
            const email = user?.email ?? "";
            const href =
              destination.scope === "organization"
                ? pathService.organizationUser({
                    organizationId: destination.organizationId,
                    userId: member.userId,
                  })
                : pathService.user({
                    projectId: destination.projectId,
                    userId: member.userId,
                  });

            return (
              <Paper
                key={member.id}
                variant="outlined"
                component={RouterLink}
                to={href}
                data-testid={`member-list-item-${member.userId}`}
                sx={{
                  p: 1.5,
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  textDecoration: "none",
                  color: "inherit",
                  "&:hover": { backgroundColor: "action.hover" },
                }}
              >
                <Avatar>{getInitials(user?.name, email)}</Avatar>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" noWrap>
                    {name}
                  </Typography>
                  {email && (
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {email}
                    </Typography>
                  )}
                </Box>
                <Chip label={member.role} size="small" />
                <MemberRowMenu
                  member={member}
                  onRemoveFromProject={onRemoveFromProject}
                  onRemoveFromOrganization={onRemoveFromOrganization}
                />
              </Paper>
            );
          })}
        </Stack>
      )}
    </Box>
  );
};
