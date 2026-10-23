import type { Meta, StoryObj } from "@storybook/react";
import { DataStateBoundary } from "./DataStateBoundary";
import { dataStateBoundaryFixtures } from "./DataStateBoundary.fixtures";

const meta: Meta<typeof DataStateBoundary> = {
  title: "Components/Shared/DataStateBoundary",
  component: DataStateBoundary,
};

export default meta;

type Story = StoryObj<typeof DataStateBoundary>;

export const Unstarted: Story = {
  args: dataStateBoundaryFixtures.unstarted,
};

export const Loading: Story = {
  args: dataStateBoundaryFixtures.loading,
};

export const Ready: Story = {
  args: dataStateBoundaryFixtures.ready,
};

export const Refreshing: Story = { args: dataStateBoundaryFixtures.refreshing };
