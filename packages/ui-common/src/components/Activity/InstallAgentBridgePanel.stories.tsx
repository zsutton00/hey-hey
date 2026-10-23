import type { Meta, StoryObj } from "@storybook/react";
import { InstallAgentBridgePanel } from "./InstallAgentBridgePanel";

const meta: Meta<typeof InstallAgentBridgePanel> = {
  title: "Components/Activity/InstallAgentBridgePanel",
  component: InstallAgentBridgePanel,
};

export default meta;

type Story = StoryObj<typeof InstallAgentBridgePanel>;

export const Default: Story = {};
