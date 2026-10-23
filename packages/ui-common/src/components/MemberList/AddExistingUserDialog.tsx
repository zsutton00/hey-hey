import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import { ProjectRole, type OrganizationMemberResponseDto } from "../../api";

const ROLE_OPTIONS: { value: ProjectRole; label: string }[] = [
  { value: ProjectRole.Owner, label: "Owner" },
  { value: ProjectRole.Architect, label: "Architect" },
  { value: ProjectRole.Member, label: "Member" },
  { value: ProjectRole.Viewer, label: "Viewer" },
];

export type AddExistingUserError =
  | { kind: "duplicate"; message?: string }
  | { kind: "generic"; message: string };

export interface AddExistingUserDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (userId: string, role: ProjectRole) => void;
  candidates: OrganizationMemberResponseDto[];
  candidatesLoading?: boolean;
  loading?: boolean;
  error?: AddExistingUserError | null;
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

const getOptionLabel = (option: OrganizationMemberResponseDto): string =>
  option.user?.name || option.user?.email || option.userId;

export const AddExistingUserDialog: React.FC<AddExistingUserDialogProps> = ({
  open,
  onClose,
  onSubmit,
  candidates,
  candidatesLoading = false,
  loading = false,
  error = null,
}) => {
  const [selected, setSelected] =
    useState<OrganizationMemberResponseDto | null>(null);
  const [role, setRole] = useState<ProjectRole>(ProjectRole.Member);
  const [selectionError, setSelectionError] = useState<string | undefined>(
    undefined
  );

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setRole(ProjectRole.Member);
      setSelectionError(undefined);
    }
  }, [open]);

  const sortedCandidates = useMemo(
    () =>
      [...candidates].sort((a, b) =>
        getOptionLabel(a).localeCompare(getOptionLabel(b))
      ),
    [candidates]
  );

  const handleSelectionChange = useCallback(
    (
      _event: React.SyntheticEvent,
      value: OrganizationMemberResponseDto | null
    ) => {
      setSelected(value);
      if (selectionError) setSelectionError(undefined);
    },
    [selectionError]
  );

  const handleRoleChange = useCallback(
    (event: SelectChangeEvent<ProjectRole>) => {
      setRole(event.target.value as ProjectRole);
    },
    []
  );

  const handleSubmit = useCallback(() => {
    if (!selected) {
      setSelectionError("Choose a user to add");
      return;
    }
    onSubmit(selected.userId, role);
  }, [selected, role, onSubmit]);

  const handleClose = useCallback(() => {
    if (!loading) onClose();
  }, [loading, onClose]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="add-existing-user-dialog-title"
      data-testid="add-existing-user-dialog"
    >
      <DialogTitle id="add-existing-user-dialog-title">
        Add existing user
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error?.kind === "duplicate" && (
            <Alert severity="warning" data-testid="add-existing-user-duplicate">
              {error.message ||
                "That user is already a member of this project."}
            </Alert>
          )}
          {error?.kind === "generic" && (
            <Alert severity="error" data-testid="add-existing-user-error">
              {error.message}
            </Alert>
          )}

          <Autocomplete
            fullWidth
            options={sortedCandidates}
            value={selected}
            onChange={handleSelectionChange}
            loading={candidatesLoading}
            disabled={loading}
            getOptionLabel={getOptionLabel}
            isOptionEqualToValue={(a, b) => a.userId === b.userId}
            noOptionsText={
              candidatesLoading
                ? "Loading users…"
                : "No organization users available to add"
            }
            renderOption={(props, option) => {
              const { key, ...rest } =
                props as React.HTMLAttributes<HTMLLIElement> & {
                  key?: React.Key;
                };
              const user = option.user;
              const name = user?.name || "Unknown user";
              const email = user?.email ?? "";
              return (
                <li
                  key={key ?? option.userId}
                  {...rest}
                  data-testid={`add-existing-user-option-${option.userId}`}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      width: "100%",
                    }}
                  >
                    <Avatar sx={{ width: 28, height: 28, fontSize: 12 }}>
                      {getInitials(user?.name, email)}
                    </Avatar>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        {name}
                      </Typography>
                      {email && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                          component="div"
                        >
                          {email}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </li>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="User"
                placeholder="Search organization users"
                error={!!selectionError}
                helperText={selectionError}
                inputProps={{
                  ...params.inputProps,
                  "aria-label": "User",
                  "data-testid": "add-existing-user-input",
                }}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {candidatesLoading ? (
                        <CircularProgress size={16} />
                      ) : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />

          <FormControl fullWidth disabled={loading}>
            <InputLabel id="add-existing-user-role-label">Role</InputLabel>
            <Select
              labelId="add-existing-user-role-label"
              label="Role"
              value={role}
              onChange={handleRoleChange}
              inputProps={{ "data-testid": "add-existing-user-role" }}
            >
              {ROLE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading || !selected}
          startIcon={loading ? <CircularProgress size={16} /> : undefined}
          data-testid="add-existing-user-submit"
        >
          {loading ? "Adding…" : "Add to project"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
