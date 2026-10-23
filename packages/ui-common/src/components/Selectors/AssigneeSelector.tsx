import React from "react";
import {
  Select,
  MenuItem,
  Chip,
  FormControl,
  FormHelperText,
  InputLabel,
  CircularProgress,
  Box,
  Button,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import { useUsers } from "../../data/hooks";
import { useAuth } from "../../contexts/AuthContext";

export interface AssigneeSelectorProps {
  value: string | null;
  onChange: (assigneeId: string | null) => void;
  organizationId: string;
  label?: string;
  helperText?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: "small" | "medium";
  error?: boolean;
  enableAssignToMe?: boolean;
}

export const AssigneeSelector: React.FC<AssigneeSelectorProps> = ({
  value,
  onChange,
  organizationId,
  label = "Assignee",
  helperText,
  disabled = false,
  fullWidth = false,
  size = "medium",
  error = false,
  enableAssignToMe = false,
}) => {
  const { user: currentUser } = useAuth();
  const {
    data: allMembers,
    isLoading: loading,
    error: apiError,
  } = useUsers(organizationId);

  // Filter for active members with user details
  const members = allMembers
    .filter((member) => member.isActive && member.user)
    .map((member) => ({
      id: member.userId,
      name: member.user?.name || "Unknown User",
      userId: member.userId,
    }));

  const handleChange = (event: SelectChangeEvent<string | "null">): void => {
    const selectedValue = event.target.value;
    onChange(selectedValue === "null" ? null : selectedValue);
  };

  const selectedMember = members.find((m) => m.userId === value);
  const displayName =
    selectedMember?.name || (value ? "Unknown User" : "Unassigned");
  const errorMessage = apiError instanceof Error ? apiError.message : apiError;

  const showAssignToMe =
    enableAssignToMe &&
    !!currentUser?.id &&
    !disabled &&
    value !== currentUser.id;

  const formControl = (
    <FormControl
      fullWidth={fullWidth}
      error={error || !!apiError}
      size={size}
      disabled={disabled || loading}
    >
      {label && <InputLabel>{label}</InputLabel>}
      <Select
        value={value || "null"}
        onChange={handleChange}
        disabled={disabled || loading}
        label={label}
        renderValue={() => (
          <Chip
            label={displayName}
            size="small"
            sx={{ fontWeight: "bold" }}
            color={value ? "default" : "default"}
            variant={value ? "filled" : "outlined"}
          />
        )}
        sx={{
          "& .MuiSelect-select": {
            padding: "8px 12px",
          },
        }}
      >
        <MenuItem value="null">
          <Chip label="Unassigned" size="small" variant="outlined" />
        </MenuItem>
        {loading && (
          <MenuItem disabled>
            <CircularProgress size={20} sx={{ mr: 1 }} />
            Loading members...
          </MenuItem>
        )}
        {!loading &&
          members.map((member) => (
            <MenuItem key={member.userId} value={member.userId}>
              <Chip
                label={member.name}
                size="small"
                sx={{ fontWeight: "bold" }}
              />
            </MenuItem>
          ))}
      </Select>
      {(helperText || apiError) && (
        <FormHelperText>{errorMessage || helperText}</FormHelperText>
      )}
    </FormControl>
  );

  if (!showAssignToMe) {
    return formControl;
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 1,
        width: fullWidth ? "100%" : undefined,
      }}
    >
      <Box sx={{ flex: fullWidth ? 1 : undefined, minWidth: 0 }}>
        {formControl}
      </Box>
      <Button
        type="button"
        size={size}
        variant="outlined"
        onClick={() => onChange(currentUser!.id)}
        sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
      >
        Assign to me
      </Button>
    </Box>
  );
};
