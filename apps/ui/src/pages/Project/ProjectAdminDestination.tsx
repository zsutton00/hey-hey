import { ProjectHintsSubtab } from "./ProjectHintsSubtab";
import { Box, Tab, Tabs } from "@mui/material";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import React from "react";

const adminSubtabs = ["hints"] as const;

export interface ProjectAdminDestinationProps {
  projectId: string;
  organizationId: string;
}

// Read-only debug view for platform admins; the Admin destination is only
// reachable once the server has confirmed the caller is one.
export const ProjectAdminDestination: React.FC<
  ProjectAdminDestinationProps
> = ({ projectId, organizationId }) => {
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
      <ProjectHintsSubtab
        projectId={projectId}
        organizationId={organizationId}
      />
    </>
  );
};
