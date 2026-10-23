import {
  ProjectConfigVersionEnum,
  ProjectExistingWorkIntent,
  type ProjectResponseDto,
} from "@hey-hey/ui-common/api";

export const isSelectedExistingWorkProject = (
  project: Pick<ProjectResponseDto, "config"> | null | undefined,
): boolean =>
  project?.config?.version === ProjectConfigVersionEnum.NUMBER_1 &&
  project.config.existingWorkIntent === ProjectExistingWorkIntent.Selected;
