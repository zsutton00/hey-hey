import { WebPathService } from "@hey-hey/ui-common";
import { Box, Button } from "@mui/material";
import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { OrientationContent } from "../../NewOrgLanding/OrientationContent";

export interface ProjectSetupIntroductionProps {
  projectId: string;
  projectName: string;
}

export const ProjectSetupIntroduction: React.FC<
  ProjectSetupIntroductionProps
> = ({ projectId, projectName }) => {
  const navigate = useNavigate();
  const handleStart = useCallback(() => {
    navigate(WebPathService.onboarding({ projectId, isNew: true }));
  }, [navigate, projectId]);

  return (
    <Box
      component="main"
      data-testid="project-setup-introduction"
      sx={{
        display: "flex",
        justifyContent: "center",
        px: { xs: 2, sm: 3 },
        py: 4,
      }}
    >
      <OrientationContent
        heading={`Setting up ${projectName}`}
        cta={
          <Button
            variant="contained"
            size="large"
            onClick={handleStart}
            data-testid="project-setup-start"
            sx={{ px: 6, py: 1.75, fontSize: "1.125rem" }}
          >
            Start setting up your project
          </Button>
        }
      />
    </Box>
  );
};
