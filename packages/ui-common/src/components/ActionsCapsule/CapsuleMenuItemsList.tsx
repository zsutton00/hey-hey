import { Badge, Box } from "@mui/material";
import React from "react";
import type { CapsuleActionMenuItem } from "./types";

export interface CapsuleMenuItemsListProps {
  /** List of menu items to render */
  menuItems: CapsuleActionMenuItem[];
  /** Callback when a menu item is clicked */
  onItemClick: (itemId: string) => void;
  /** Color index for theming (0-4) */
  colorIndex?: number;
  /** Width of inactive capsule for responsive menu sizing */
  inactiveWidth?: number | null;
}

/**
 * Renders a vertical list of menu items in the ActionsCapsule expanded area
 */
export const CapsuleMenuItemsList: React.FC<CapsuleMenuItemsListProps> = ({
  menuItems,
  onItemClick,
  inactiveWidth,
}) => {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        width:
          inactiveWidth && inactiveWidth >= 150 ? inactiveWidth : undefined,
      }}
    >
      {menuItems.map((item) => {
        const Icon = item.icon ? <item.icon /> : undefined;

        return (
          <Box
            key={item.id}
            onClick={() => onItemClick(item.id)}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 2,
              py: 1.5,
              cursor: item.disabled ? "not-allowed" : "pointer",
              opacity: item.disabled ? 0.5 : 1,
              borderBottom: "1px solid",
              borderColor: "divider",
              "&:last-child": {
                borderBottom: "none",
              },
              ...(item.disabled
                ? {}
                : {
                    "&:hover": {
                      backgroundColor: "action.hover",
                    },
                  }),
            }}
            data-testid={`capsule-menu-item-${item.id}`}
          >
            {Icon && (
              <Box
                sx={{ display: "flex", color: "inherit", fontSize: "1.2em" }}
              >
                {Icon}
              </Box>
            )}
            <Box sx={{ flex: 1, fontSize: "1.1em" }}>{item.label}</Box>
            {item.badge !== undefined && (
              <Badge badgeContent={item.badge} color="primary" />
            )}
          </Box>
        );
      })}
    </Box>
  );
};
