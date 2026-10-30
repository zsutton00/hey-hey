import { useMemo } from "react";
import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import { useAdminProjectHints, useEntityNames } from "@hey-hey/ui-common/data";
import { EntityLinkWithPreview } from "@hey-hey/ui-common";

export function ProjectHintsSubtab({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { hints, isLoading, error } = useAdminProjectHints(
    organizationId,
    projectId,
  );
  const entities = useMemo(
    () =>
      hints
        .flatMap((hint) => hint.connections)
        .flatMap((connection) =>
          connection.targetEntityType === "HINT"
            ? []
            : [
                {
                  entityId: connection.targetNodeId,
                  entityType: connection.targetEntityType,
                },
              ],
        ),
    [hints],
  );
  const {
    names,
    isLoading: namesLoading,
    error: namesError,
  } = useEntityNames({ organizationId, entities });
  return (
    <Stack spacing={3} sx={{ mt: 3 }} data-testid="project-admin-hints">
      <Typography variant="h6" component="h2">
        Hints
      </Typography>
      {isLoading ? (
        <CircularProgress size={24} aria-label="Loading hints" />
      ) : error ? (
        <Alert severity="error">
          Hints could not be loaded: {error.message}
        </Alert>
      ) : hints.length === 0 ? (
        <Typography color="text.secondary">
          This project has no live Hints.
        </Typography>
      ) : (
        hints.map((hint) => (
          <Box key={hint.id} data-testid="project-admin-hint">
            <Typography sx={{ whiteSpace: "pre-wrap" }}>{hint.text}</Typography>
            <Stack component="ul" spacing={1} sx={{ pl: 3 }}>
              {hint.connections.map((connection) => {
                const title =
                  connection.targetEntityType === "HINT"
                    ? hints.find((item) => item.id === connection.targetNodeId)
                        ?.text
                    : names.get(
                        `${connection.targetEntityType}:${connection.targetNodeId}`,
                      );
                return (
                  <Box
                    component="li"
                    key={connection.id}
                    data-testid="project-admin-hint-connection"
                  >
                    {title ? (
                      <EntityLinkWithPreview
                        label={title}
                        entityId={connection.targetNodeId}
                        entityType={connection.targetEntityType.toLowerCase()}
                        organizationId={organizationId}
                        projectId={projectId}
                      />
                    ) : (
                      <Typography component="span" color="text.secondary">
                        {namesLoading
                          ? "Loading connected item…"
                          : "Connected item unavailable"}
                      </Typography>
                    )}
                    <Typography component="span" variant="body2">
                      {" "}
                      — {connection.targetEntityType}, strength{" "}
                      {connection.strength}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
          </Box>
        ))
      )}
      {namesError && (
        <Alert severity="error">
          Connected item names could not be loaded: {namesError}
        </Alert>
      )}
    </Stack>
  );
}
