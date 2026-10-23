import { Chip, Stack, Typography } from "@mui/material";
import type { ProjectResponseDto } from "../../api";
import {
  formatProjectUpdatedAt,
  formatProjectStatus,
  projectStatusChipColor,
} from "../OrganizationHome/organizationHomeProjects";

type ProjectMetadataProps = Pick<ProjectResponseDto, "updatedAt" | "status">;

export const ProjectUpdatedAt = ({
  updatedAt,
}: Pick<ProjectResponseDto, "updatedAt">) => (
  <Typography
    component="span"
    variant="caption"
    data-testid="project-updated-at"
  >
    Updated{" "}
    <time dateTime={updatedAt}>{formatProjectUpdatedAt(updatedAt)}</time>
  </Typography>
);

export const ProjectStatusChip = ({
  status,
}: Pick<ProjectResponseDto, "status">) => (
  <Chip
    label={formatProjectStatus(status)}
    aria-label={`Project status: ${formatProjectStatus(status)}`}
    color={projectStatusChipColor(status)}
    size="small"
    variant="outlined"
    sx={{ height: 22, flexShrink: 0 }}
  />
);

export const ProjectMetadata = ({
  updatedAt,
  status,
}: ProjectMetadataProps) => (
  <Stack
    direction="row"
    spacing={1}
    alignItems="center"
    data-testid="project-metadata"
    sx={{ flexWrap: "nowrap", whiteSpace: "nowrap", color: "text.secondary" }}
  >
    <ProjectUpdatedAt updatedAt={updatedAt} />
    <ProjectStatusChip status={status} />
  </Stack>
);
