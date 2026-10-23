import type { ProjectContextValue } from "../../src/contexts/ProjectContext";

const STORYBOOK_ORGANIZATION_ID = "storybook-org";
const STORYBOOK_PROJECT_ID = "storybook-project";

export const storybookProjectContextValue: ProjectContextValue = {
  organizationId: STORYBOOK_ORGANIZATION_ID,
  projectId: STORYBOOK_PROJECT_ID,
  navigate: () => {},
};
