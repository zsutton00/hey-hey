import type { Meta, StoryObj } from "@storybook/react";
import { LocalRuntimeUnavailableAlert } from "./LocalRuntimeUnavailableAlert";

const meta: Meta<typeof LocalRuntimeUnavailableAlert> = {
  title: "Components/AgentSession/LocalRuntimeUnavailableAlert",
  component: LocalRuntimeUnavailableAlert,
  parameters: {
    docs: {
      description: {
        component:
          "Demoted to an informational '(this device)' hint. The launch-blocking " +
          "install panel is gone — missing-CLI guidance now lives on the start " +
          "button via the platform's useConversationCliStatus reading.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof LocalRuntimeUnavailableAlert>;

export const Default: Story = {
  args: {
    error: null,
  },
};
