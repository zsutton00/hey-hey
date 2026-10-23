import React from "react";
import { Box, Stack, Tooltip, IconButton } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { EntityIcon } from "@hey-hey/ui-common/components/Entity";

interface ExplorerMinimalProps {
  projectId: string;
}

interface MinimalNavItem {
  icon: React.ReactNode;
  label: string;
  path: string;
}

/**
 * Minimal icon-only explorer view
 * Shown when drawer width is below threshold
 */
export const ExplorerMinimal: React.FC<ExplorerMinimalProps> = ({
  projectId,
}) => {
  const navigate = useNavigate();

  const navItems: MinimalNavItem[] = [
    {
      icon: <EntityIcon entityType="feature" size={24} />,
      label: "Features",
      path: `/projects/${projectId}/features`,
    },
    {
      icon: <EntityIcon entityType="goal" size={24} />,
      label: "Active Goals",
      path: `/projects/${projectId}/goals`,
    },
    {
      icon: <EntityIcon entityType="plan" size={24} />,
      label: "Active Plans",
      path: `/projects/${projectId}/plans`,
    },
    {
      icon: <EntityIcon entityType="service" size={24} />,
      label: "Services",
      path: `/projects/${projectId}/services`,
    },
  ];

  const handleNavigation = (path: string): void => {
    navigate(path);
  };

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pt: 2,
        pb: 2,
      }}
    >
      <Stack spacing={1} alignItems="center">
        {navItems.map((item) => (
          <Tooltip key={item.path} title={item.label} placement="right">
            <IconButton
              onClick={() => handleNavigation(item.path)}
              sx={{
                color: "text.primary",
                "&:hover": {
                  bgcolor: "action.hover",
                  color: "heyhey.main",
                },
              }}
            >
              {item.icon}
            </IconButton>
          </Tooltip>
        ))}
      </Stack>
    </Box>
  );
};
