import { Typography } from "@mui/material";
import { useEntityDetails } from "../../data/hooks/useEntityDetails";
import { useUsers } from "../../data/hooks/useUsers";
import { EntityLinkWithPreview } from "../Entity";
import type { DesignDocParentEntityType } from "../../api";

export function FutureReferenceValue({
  entityId,
  entityType,
  organizationId,
  projectId,
}: {
  entityId: string;
  entityType: DesignDocParentEntityType | "USER" | "INITIATIVE";
  organizationId: string;
  projectId: string | null | undefined;
}) {
  const details = useEntityDetails({
    entityId,
    entityType,
    organizationId,
    projectId: projectId ?? undefined,
    enabled: entityType !== "USER",
  });
  const users = useUsers(organizationId, { enabled: entityType === "USER" });
  const user = users.data.find((member) => member.userId === entityId);
  const label =
    entityType === "USER"
      ? user?.user?.name
      : details.data && "name" in details.data
        ? details.data.name
        : undefined;
  if (details.isLoading || (entityType === "USER" && users.isLoading))
    return <Typography>Loading…</Typography>;
  if (
    !label ||
    (details.data &&
      "status" in details.data &&
      details.data.status === "ARCHIVED")
  )
    return <Typography>Reference unavailable</Typography>;
  return (
    <EntityLinkWithPreview
      {...{ entityId, entityType, organizationId, label }}
      projectId={projectId ?? undefined}
    />
  );
}
