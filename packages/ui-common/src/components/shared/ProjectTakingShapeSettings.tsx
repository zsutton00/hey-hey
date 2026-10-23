import { useRef, useState } from "react";
import {
  Alert,
  Box,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Typography,
} from "@mui/material";
import { ProjectMaturity } from "../../api";
import { useProject } from "../../data/hooks/useProject";
import { useUpdateProject } from "../../data/hooks/useProjectMutations";

export const ProjectTakingShapeSettings = ({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) => {
  const project = useProject(organizationId, projectId);
  const update = useUpdateProject(organizationId);
  const saving = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (maturity: ProjectMaturity) => {
    if (saving.current || !project.data || maturity === project.data.maturity)
      return;
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      await update(projectId, { maturity });
    } catch {
      setError(
        "Could not save the maturity stage. Your previous setting has been restored. Try again.",
      );
    } finally {
      saving.current = false;
      setPending(false);
    }
  };

  return (
    <Box data-testid="project-taking-shape-settings" sx={{ my: 2 }}>
      <Typography variant="h6">Project context</Typography>
      {project.error ? (
        <Alert severity="error">
          Could not load the project setting. Reload to try again.
        </Alert>
      ) : !project.data ? (
        <Typography>Loading project setting…</Typography>
      ) : (
        <FormControl disabled={pending}>
          <FormLabel id="project-maturity-label">Maturity stage</FormLabel>
          <RadioGroup
            aria-labelledby="project-maturity-label"
            value={project.data.maturity}
            onChange={(_, value) => void save(value as ProjectMaturity)}
            data-testid="project-maturity-selector"
          >
            <FormControlLabel
              value={ProjectMaturity.TakingShape}
              control={<Radio />}
              label="Taking shape"
            />
            <FormControlLabel
              value={ProjectMaturity.Established}
              control={<Radio />}
              label="Established"
            />
          </RadioGroup>
        </FormControl>
      )}
      <Typography variant="body2" color="text.secondary">
        Choose Taking shape while most of what you have said still lives in
        conversations. You control this setting; project status and setup do not
        change it.
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
};
