import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import React from "react";
import { EntityLinkWithPreview } from "../Entity";
import { usePathService } from "../../contexts/PathServiceContext";
import type { ModeAvailabilityState } from "./modeAvailability";

export interface ModeAvailabilitySummaryProps {
  availability: ModeAvailabilityState;
  organizationId: string;
  projectId: string;
}

export const ModeAvailabilitySummary: React.FC<
  ModeAvailabilitySummaryProps
> = ({ availability, organizationId, projectId }) => {
  const pathService = usePathService();

  if (availability.kind === "not-applicable") return null;

  return (
    <Box data-testid="mode-availability-summary" aria-live="polite">
      <Typography variant="caption" color="text.secondary">
        Availability
      </Typography>
      {availability.kind === "loading" ? (
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}
          data-testid="mode-availability-loading"
        >
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">
            Resolving Feature availability…
          </Typography>
        </Box>
      ) : availability.kind === "error" ? (
        <Alert
          severity="error"
          sx={{ mt: 0.5 }}
          data-testid="mode-availability-error"
        >
          Feature availability could not be determined.
        </Alert>
      ) : availability.features.length === 0 ? (
        <Typography
          variant="body2"
          data-testid="mode-availability-project-wide"
        >
          Available project-wide
        </Typography>
      ) : (
        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Available in these Features and their descendants:
          </Typography>
          {availability.features.map((feature) => (
            <Box key={feature.id} sx={{ pl: 0.5 }}>
              <EntityLinkWithPreview
                label={feature.name}
                entityId={feature.id}
                entityType="feature"
                organizationId={organizationId}
                projectId={projectId}
                href={pathService.feature({
                  projectId,
                  featureId: feature.id,
                })}
                testId="mode-availability-feature-link"
              />
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
};
