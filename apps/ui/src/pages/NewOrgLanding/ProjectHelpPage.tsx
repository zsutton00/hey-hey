import { Box } from "@mui/material";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import React from "react";

import { DeepHelpView, IntroHelpView } from "@hey-hey/ui-common/components";
import { useProject } from "@hey-hey/ui-common/data";

import {
  SegmentedToggle,
  type Segment,
} from "../../components/SegmentedToggle";
import { ProjectHelpProvider } from "../Project/help/ProjectHelpProvider";
import { isSelectedExistingWorkProject } from "../Project/help/projectSetupRoute";

interface ProjectHelpPageProps {
  organizationId: string;
  projectId: string;
}

const projectHelpSections = ["welcome", "first-project", "help"] as const;
type ProjectHelpSection = (typeof projectHelpSections)[number];

const projectHelpSegments: readonly Segment<ProjectHelpSection>[] = [
  { value: "welcome", label: "Welcome" },
  { value: "first-project", label: "Your First Project" },
  { value: "help", label: "Help" },
];

/** In-project Help journey from orientation through guided and reference help. */
export const ProjectHelpPage: React.FC<ProjectHelpPageProps> = ({
  organizationId,
  projectId,
}) => {
  const { data: project } = useProject(organizationId, projectId, {
    preferStale: true,
  });
  const isSelectedExistingWork = isSelectedExistingWorkProject(project);
  const excludedTopicIds = isSelectedExistingWork
    ? ["features-ready"]
    : undefined;
  const [helpSection, setHelpSection] = useQueryState(
    "helpSubTab",
    parseAsStringLiteral(projectHelpSections).withDefault("welcome"),
  );
  const activeSection: ProjectHelpSection = projectHelpSections.includes(
    helpSection as ProjectHelpSection,
  )
    ? (helpSection as ProjectHelpSection)
    : "welcome";

  return (
    <ProjectHelpProvider organizationId={organizationId} projectId={projectId}>
      <Box
        sx={{
          width: "100%",
        }}
      >
        <Box sx={{ mb: 3, maxWidth: "100%", minWidth: 0 }}>
          <SegmentedToggle
            segments={projectHelpSegments}
            value={activeSection}
            onChange={(value) =>
              void setHelpSection(value, { history: "push" })
            }
            mobileDropdown
          />
        </Box>
        <Box sx={{ display: "flex", justifyContent: "center", width: "100%" }}>
          {activeSection === "welcome" ? (
            <IntroHelpView
              variant={isSelectedExistingWork ? "existing-work" : "generic"}
            />
          ) : (
            <DeepHelpView
              rootSection={activeSection}
              excludedTopicIds={excludedTopicIds}
            />
          )}
        </Box>
      </Box>
    </ProjectHelpProvider>
  );
};
