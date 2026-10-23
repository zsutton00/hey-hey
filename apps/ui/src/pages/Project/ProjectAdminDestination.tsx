import { useAdminProjectImplementationHints } from "@hey-hey/ui-common/data";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import React from "react";

const adminSubtabs = ["hints"] as const;

export interface ProjectAdminDestinationProps {
  projectId: string;
}

// Read-only debug view for platform admins; the Admin destination is only
// reachable once the server has confirmed the caller is one.
export const ProjectAdminDestination: React.FC<
  ProjectAdminDestinationProps
> = ({ projectId }) => {
  const [adminSubtab, setAdminSubtab] = useQueryState(
    "adminSubTab",
    parseAsStringLiteral(adminSubtabs).withDefault("hints"),
  );

  return (
    <>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          aria-label="Project admin sections"
          value={adminSubtab}
          onChange={(_, value: (typeof adminSubtabs)[number]) =>
            void setAdminSubtab(value)
          }
        >
          <Tab label="Hints" value="hints" />
        </Tabs>
      </Box>
      <ProjectHintsSubtab projectId={projectId} />
    </>
  );
};

const ProjectHintsSubtab: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { services, isLoading, error } =
    useAdminProjectImplementationHints(projectId);

  return (
    <Stack spacing={4} sx={{ mt: 3 }} data-testid="project-admin-hints">
      <Box component="section">
        <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
          Implementation hints
        </Typography>
        {isLoading ? (
          <CircularProgress
            size={24}
            aria-label="Loading implementation hints"
          />
        ) : error ? (
          <Alert severity="error">
            Implementation hints could not be loaded: {error.message}
          </Alert>
        ) : services.length === 0 ? (
          <Typography color="text.secondary">
            This project has no Services.
          </Typography>
        ) : (
          services.map((service) => (
            <Box key={service.serviceId} sx={{ mb: 3 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="subtitle1" component="h3">
                  {service.serviceName}
                </Typography>
                {service.archivedAt && <Chip size="small" label="Archived" />}
                <Typography variant="body2" color="text.secondary">
                  {service.hints.length}{" "}
                  {service.hints.length === 1 ? "hint" : "hints"}
                </Typography>
              </Stack>
              {service.hints.map((hint) => (
                <Box
                  key={hint.id}
                  sx={{ mt: 1.5, pl: 2, borderLeft: 2, borderColor: "divider" }}
                >
                  <Typography variant="subtitle2">
                    {hint.featureName}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                    {hint.hint ?? hint.description}
                  </Typography>
                </Box>
              ))}
            </Box>
          ))
        )}
      </Box>

      <Box component="section">
        <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
          Hints
        </Typography>
        <Alert severity="info">
          The new Hints list is not available yet: the graph service has no read
          that lists a project's hints with their connections and strengths.
        </Alert>
      </Box>
    </Stack>
  );
};
