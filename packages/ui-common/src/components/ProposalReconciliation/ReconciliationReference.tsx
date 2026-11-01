import { Typography } from "@mui/material";
import { useEntityDetails } from "../../data/hooks/useEntityDetails";
import { useUsers } from "../../data/hooks/useUsers";
import { EntityLinkWithPreview } from "../Entity/EntityLinkWithPreview";

export function ReconciliationReference({
  entityId,
  entityType,
  organizationId,
  projectId,
}: {
  entityId: string;
  entityType: string;
  organizationId: string;
  projectId: string;
}) {
  const details = useEntityDetails({
    entityId,
    entityType,
    organizationId,
    projectId,
    enabled: entityType !== "user",
  });
  const users = useUsers(organizationId, { enabled: entityType === "user" });
  const label =
    entityType === "user"
      ? users.data.find((member) => member.userId === entityId)?.user?.name
      : details.data && "name" in details.data
        ? details.data.name
        : details.data && "title" in details.data
          ? details.data.title
          : undefined;
  if (!label)
    return (
      <Typography variant="body2" color="text.secondary">
        {details.isLoading || users.isLoading
          ? "Loading reference…"
          : "Reference details are unavailable."}
      </Typography>
    );
  return (
    <EntityLinkWithPreview
      entityId={entityId}
      entityType={entityType}
      organizationId={organizationId}
      projectId={projectId}
      label={label}
    />
  );
}
