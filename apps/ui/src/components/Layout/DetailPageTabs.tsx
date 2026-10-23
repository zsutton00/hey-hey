import React from "react";
import { ResponsiveTabs } from "@hey-hey/ui-common/components";
import type {
  ResponsiveTabOverflow,
  ResponsiveTabsProps,
} from "@hey-hey/ui-common/components";
import type { Options } from "nuqs";
import { Box, Tooltip, useTheme } from "@mui/material";

export interface DetailPageTab {
  value: string;
  label: string;
  tooltip?: string;
}

export interface DetailPageTabsProps<T extends string = string> {
  value: T;
  onChange: (
    value: T | ((old: T) => T | null) | null,
    options?: Options
  ) => void | Promise<URLSearchParams>;
  tabs: DetailPageTab[];
  overflow?: ResponsiveTabOverflow;
}

export const DetailPageTabs = <T extends string = string>({
  value,
  onChange,
  tabs,
  overflow = "scroll",
}: DetailPageTabsProps<T>): React.ReactElement => {
  const theme = useTheme();

  const tabsWithTooltips = tabs.map((tab) =>
    tab.tooltip
      ? {
          ...tab,
          label: (
            <Tooltip title={tab.tooltip} arrow describeChild placement="top">
              <span>{tab.label}</span>
            </Tooltip>
          ),
        }
      : tab
  );

  return (
    <Box
      data-testid="detail-page-tabs"
      sx={{
        minWidth: 0,
        [theme.breakpoints.down("md")]: {
          height: 48,
          maxHeight: 48,
          "& [role='tablist']": {
            minHeight: 48,
          },
          "& [role='tab'], & button, & .MuiTab-root": {
            minHeight: 48,
            height: 48,
            fontSize: "13px",
            lineHeight: 1.2,
          },
        },
      }}
    >
      <ResponsiveTabs
        value={value}
        onChange={onChange as ResponsiveTabsProps<T>["onChange"]}
        tabs={tabsWithTooltips as unknown as ResponsiveTabsProps<T>["tabs"]}
        overflow={overflow}
      />
    </Box>
  );
};
