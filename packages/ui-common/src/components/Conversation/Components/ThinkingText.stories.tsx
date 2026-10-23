import type { Meta, StoryObj } from "@storybook/react";
import { Box } from "@mui/material";
import { AgentSessionCurrentState } from "../../../api";
import { ThinkingText } from "./ThinkingText";

const meta: Meta<typeof ThinkingText> = {
  title: "Components/Conversation/ThinkingText",
  component: ThinkingText,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <Box sx={{ minHeight: 240, display: "flex", alignItems: "flex-start" }}>
        <Story />
      </Box>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof ThinkingText>;

export const Thinking: Story = {
  args: {
    text: "Thinking...",
    sx: { marginTop: 0 },
  },
};

export const WritingResponse: Story = {
  args: {
    text: "Writing Response...",
    sx: { marginTop: 0 },
  },
};

export const Starting: Story = {
  args: {
    currentState: AgentSessionCurrentState.Starting,
    text: "Starting conversation...",
    sx: { marginTop: 0 },
  },
};

export const CustomMessage: Story = {
  args: {
    text: "Reviewing proposals...",
    sx: { marginTop: 0 },
  },
};

export const SideBySide: Story = {
  render: () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <ThinkingText text="Thinking..." sx={{ marginTop: 0 }} />
      <ThinkingText text="Writing Response..." sx={{ marginTop: 0 }} />
    </Box>
  ),
};
