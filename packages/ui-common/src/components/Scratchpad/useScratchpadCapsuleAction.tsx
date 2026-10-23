import { useCallback } from "react";
import { Box, Button } from "@mui/material";
import ChatIcon from "@mui/icons-material/Chat";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import { useLocation } from "react-router-dom";
import { ScratchpadPage } from "./ScratchpadPage";
import { useScratchpad } from "./useScratchpad";
import { usePathService } from "../../contexts";
import { useUserIdentity } from "../../hooks/useUserIdentity";
import type { CapsuleActionRegistration } from "../ActionsCapsule/types";

export const useScratchpadCapsuleAction =
  (): CapsuleActionRegistration | null => {
    const { items } = useScratchpad();
    const location = useLocation();
    const userIdentity = useUserIdentity();
    const pathService = usePathService();

    const organizationId = userIdentity?.currentOrgId;
    const projectId = pathService.extractProjectId(location.pathname);
    const scratchpadPath =
      organizationId && projectId ? pathService.scratchpad(projectId) : null;

    const renderContent = useCallback(
      () => (
        <Box>
          <ScratchpadPage />
          {scratchpadPath && (
            <Box sx={{ mt: 2, display: "flex", justifyContent: "flex-end" }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ChatIcon />}
                href={scratchpadPath}
              >
                Discuss
              </Button>
            </Box>
          )}
        </Box>
      ),
      [scratchpadPath]
    );

    if (items.length === 0) return null;

    return {
      id: "scratchpad",
      label: "Scratchpad",
      icon: ContentPasteIcon,
      behavior: "expand",
      renderContent,
      badge: items.length,
      actionGroup: "conceptual",
      tier: "site",
      order: 90,
      resumable: true,
      expandable: true,
    };
  };
