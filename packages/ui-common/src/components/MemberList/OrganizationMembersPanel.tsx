import React from "react";
import { Alert, Box } from "@mui/material";
import { useUsers } from "../../data/hooks";
import { MemberList } from "./MemberList";

export interface OrganizationMembersPanelProps {
  organizationId: string;
}

export const OrganizationMembersPanel: React.FC<
  OrganizationMembersPanelProps
> = ({ organizationId }) => {
  const { data: members, isLoading, error } = useUsers(organizationId);

  if (error) {
    return (
      <Alert severity="error" data-testid="organization-members-error">
        Unable to load organization members.
      </Alert>
    );
  }

  return (
    <Box data-testid="organization-members-panel">
      <MemberList
        members={members}
        destination={{ scope: "organization", organizationId }}
        loading={isLoading}
        emptyMessage="No organization members yet"
      />
    </Box>
  );
};
