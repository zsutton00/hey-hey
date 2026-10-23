import { useState } from "react";
import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react";
import { ResponsiveTabs } from "./ResponsiveTabs";
import type { ResponsiveTab } from "./types";

const TASK_PAGE_TABS: ResponsiveTab[] = [
  { value: "task", label: "Task" },
  { value: "coding-sessions", label: "Coding Sessions (3)" },
  { value: "child-tasks", label: "Child Tasks (5)" },
  { value: "design-docs", label: "Design Docs (2)" },
  { value: "conversations", label: "Conversations (4)" },
  { value: "admin", label: "Admin" },
  { value: "data-debug", label: "Data Debug" },
];

interface HarnessProps {
  tabs: ResponsiveTab[];
  overflow?: "scroll" | "menu";
  initial?: string;
}

const ResponsiveTabsHarness: React.FC<HarnessProps> = ({
  tabs,
  overflow,
  initial,
}) => {
  const [value, setValue] = useState<string>(initial ?? tabs[0].value);
  return (
    <Box sx={{ width: "100%" }}>
      <ResponsiveTabs
        value={value}
        onChange={(next) =>
          setValue(
            typeof next === "function" ? next(value) ?? value : next ?? value
          )
        }
        tabs={tabs}
        overflow={overflow}
      />
      <Box sx={{ p: 2 }}>Active tab: {value}</Box>
    </Box>
  );
};

const meta: Meta<typeof ResponsiveTabsHarness> = {
  title: "Components/ResponsiveTabs",
  component: ResponsiveTabsHarness,
};

export default meta;

type Story = StoryObj<typeof ResponsiveTabsHarness>;

export const DesktopParity: Story = {
  args: {
    tabs: TASK_PAGE_TABS,
    overflow: "scroll",
  },
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
};

export const ScrollMode: Story = {
  args: {
    tabs: TASK_PAGE_TABS,
    overflow: "scroll",
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

export const MenuMode: Story = {
  args: {
    tabs: TASK_PAGE_TABS,
    overflow: "menu",
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

export const MenuModeOverflowActive: Story = {
  args: {
    tabs: TASK_PAGE_TABS,
    overflow: "menu",
    initial: "data-debug",
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};
