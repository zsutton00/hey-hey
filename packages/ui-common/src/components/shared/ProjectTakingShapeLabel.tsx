import { Chip, Tooltip } from "@mui/material";
import { ProjectMaturity } from "../../api";

export const ProjectTakingShapeLabel = ({
  maturity,
}: {
  maturity: ProjectMaturity;
}) => {
  if (maturity !== ProjectMaturity.TakingShape) return null;
  return (
    <Tooltip
      title="While this project is taking shape, agents look to your past conversations for context and offer to record what matters."
      describeChild
    >
      <Chip
        label="Taking shape"
        size="small"
        variant="outlined"
        tabIndex={0}
        data-testid="project-taking-shape-label"
        sx={{ flexShrink: 0, cursor: "help", color: "text.secondary" }}
      />
    </Tooltip>
  );
};
