import { Box, Tab, Tabs } from "@mui/material";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import React from "react";
import { ProjectMembersPanel } from "@hey-hey/ui-common/components";
import type { MetadataItem } from "../../components/Layout";
import { IntegrationsTab, ServicesTab } from "../../components/Tabs";
import {
  SegmentedToggle,
  type Segment,
} from "../../components/SegmentedToggle";
import { TabContainer } from "../../components/Tabs/TabContainer";
import { WorkItemTypesList } from "./AboutTabComponents";
import { EntityPromptTemplatesPanel } from "./EntityPromptTemplatesPanel";
import { ProjectAdminTab } from "./ProjectAdminTab";

const projectSettingsViews = [
  "services",
  "integrations",
  "members",
  "types",
  "administration",
] as const;
type ProjectSettingsView = (typeof projectSettingsViews)[number];

const projectSettingsSegments: readonly Segment<ProjectSettingsView>[] = [
  { value: "services", label: "Services" },
  { value: "integrations", label: "Integrations" },
  { value: "members", label: "Members" },
  { value: "types", label: "Types" },
  { value: "administration", label: "Administration" },
];

const projectTypesSubtabs = [
  "work-item-types",
  "entity-prompt-templates",
] as const;
type ProjectTypesSubtab = (typeof projectTypesSubtabs)[number];

export interface ProjectSettingsTabProps {
  metadataItems: MetadataItem[];
  organizationId: string;
  projectId: string;
}

export const ProjectSettingsTab: React.FC<ProjectSettingsTabProps> = ({
  metadataItems,
  organizationId,
  projectId,
}) => {
  const [settingsView, setSettingsView] = useQueryState(
    "settingsSubTab",
    parseAsStringLiteral(projectSettingsViews).withDefault("services"),
  );
  const [typesSubtab, setTypesSubtab] = useQueryState(
    "typesSubTab",
    parseAsStringLiteral(projectTypesSubtabs).withDefault("work-item-types"),
  );
  const activeView: ProjectSettingsView = projectSettingsViews.includes(
    settingsView as ProjectSettingsView,
  )
    ? (settingsView as ProjectSettingsView)
    : "services";
  const activeTypesSubtab: ProjectTypesSubtab = projectTypesSubtabs.includes(
    typesSubtab as ProjectTypesSubtab,
  )
    ? (typesSubtab as ProjectTypesSubtab)
    : "work-item-types";

  return (
    <Box data-testid="project-settings-tab" sx={{ mt: 2 }}>
      <Box sx={{ mb: 3, maxWidth: "100%", minWidth: 0 }}>
        <SegmentedToggle
          segments={projectSettingsSegments}
          value={activeView}
          onChange={(value) => void setSettingsView(value, { history: "push" })}
          mobileDropdown
        />
      </Box>
      {activeView === "services" && (
        <ServicesTab
          enableFilters
          organizationId={organizationId}
          projectId={projectId}
        />
      )}
      {activeView === "integrations" && (
        <IntegrationsTab
          organizationId={organizationId}
          projectId={projectId}
        />
      )}
      {activeView === "members" && (
        <ProjectMembersPanel
          key={`${organizationId}:${projectId}`}
          organizationId={organizationId}
          projectId={projectId}
        />
      )}
      {activeView === "types" && (
        <TabContainer>
          <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Tabs
              aria-label="Project type settings sections"
              value={activeTypesSubtab}
              onChange={(_, value: ProjectTypesSubtab) =>
                void setTypesSubtab(value, { history: "push" })
              }
            >
              <Tab label="Work Item Types" value="work-item-types" />
              <Tab
                label="Entity Prompt Templates"
                value="entity-prompt-templates"
              />
            </Tabs>
          </Box>
          {activeTypesSubtab === "work-item-types" && (
            <WorkItemTypesList projectId={projectId} />
          )}
          {activeTypesSubtab === "entity-prompt-templates" && (
            <EntityPromptTemplatesPanel
              organizationId={organizationId}
              projectId={projectId}
            />
          )}
        </TabContainer>
      )}
      {activeView === "administration" && (
        <ProjectAdminTab
          metadataItems={metadataItems}
          organizationId={organizationId}
          projectId={projectId}
        />
      )}
    </Box>
  );
};
