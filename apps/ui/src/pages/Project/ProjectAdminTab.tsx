import { Box, Tab, Tabs } from "@mui/material";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import React from "react";
import type { MetadataItem } from "../../components/Layout";
import { AdminTab } from "../../components/Tabs";
import { ProjectTakingShapeSettings } from "@hey-hey/ui-common/components";

const projectAdminSubtabs = ["metadata"] as const;
type ProjectAdminSubtab = (typeof projectAdminSubtabs)[number];

export interface ProjectAdminTabProps {
  metadataItems: MetadataItem[];
  organizationId: string;
  projectId: string;
}

export const ProjectAdminTab: React.FC<ProjectAdminTabProps> = ({
  metadataItems,
  organizationId,
  projectId,
}) => {
  const [adminSubtab, setAdminSubtab] = useQueryState(
    "adminSubTab",
    parseAsStringLiteral(projectAdminSubtabs).withDefault("metadata"),
  );
  const activeSubtab: ProjectAdminSubtab = projectAdminSubtabs.includes(
    adminSubtab as ProjectAdminSubtab,
  )
    ? (adminSubtab as ProjectAdminSubtab)
    : "metadata";

  return (
    <>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          aria-label="Project admin sections"
          value={activeSubtab}
          onChange={(_, value: ProjectAdminSubtab) =>
            void setAdminSubtab(value)
          }
        >
          <Tab label="Metadata" value="metadata" />
        </Tabs>
      </Box>
      {activeSubtab === "metadata" && (
        <>
          <ProjectTakingShapeSettings
            organizationId={organizationId}
            projectId={projectId}
          />
          <AdminTab metadataItems={metadataItems} />
        </>
      )}
    </>
  );
};
