import { Stack, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import type { FutureDependencyPresentation } from "../../api";
import { getStatusLabel } from "../../utils/statusUtils";
import { MentionBadgeInner } from "../SmarterTextAreaCard/MentionBadge";
import { MentionEditorContext } from "../SmarterTextAreaCard/EditorContext";

/** Display identity comes from review responses; rendering never reads linked work. */
export function FutureDependency({
  organizationId,
  projectId,
  dependency,
}: {
  organizationId: string;
  projectId: string;
  dependency: FutureDependencyPresentation;
}) {
  const navigate = useNavigate();
  if (dependency.availability === "UNAVAILABLE") {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="future-dependency-unavailable"
      >
        Linked work unavailable
      </Typography>
    );
  }
  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      sx={{ minWidth: 0 }}
      data-testid="future-dependency"
      data-task-id={dependency.targetEntityId}
    >
      <MentionEditorContext.Provider
        value={{ organizationId, projectId, navigate }}
      >
        <MentionBadgeInner
          mention={{
            entityId: dependency.targetEntityId,
            entityType: dependency.workItemType.toLowerCase(),
            entityName: dependency.title,
          }}
        />
      </MentionEditorContext.Provider>
      {dependency.status && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ whiteSpace: "nowrap" }}
        >
          {getStatusLabel(dependency.status)}
        </Typography>
      )}
    </Stack>
  );
}

export function FutureDependencyName({
  dependency,
}: {
  dependency: FutureDependencyPresentation;
}) {
  return (
    <>
      {dependency.availability === "AVAILABLE"
        ? dependency.title
        : "unavailable linked work"}
    </>
  );
}
