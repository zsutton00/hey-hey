import type { Meta, StoryObj } from "@storybook/react";
import {
  SystemMessageDataTypeEnum,
  type SystemMessageData,
} from "../../../api";
import type { MessageRetryState } from "../../../types/conversation";
import { SystemMessage } from "./SystemMessage";

const buildMessageData = (
  overrides: Partial<SystemMessageData> & Pick<SystemMessageData, "type">
): SystemMessageData => ({
  ...overrides,
});

const noopRetryState: MessageRetryState = {
  isRetrying: false,
  retry: async () => {},
  cancelRetry: () => {},
};

const populatedText = [
  "Here's the next step for @[task:task-1|Draft onboarding spec], aligned with @[feature:feature-1|Onboarding].",
  "",
  "Key checks before merging:",
  "",
  "- Validate the schema migration is reversible",
  "- Wire the new event into the bridge",
  "- Confirm `pnpm test` passes locally",
  "",
  "```ts",
  "const result = await runMigration({ dryRun: true });",
  "```",
].join("\n");

const meta: Meta<typeof SystemMessage> = {
  title: "Components/Conversation/SystemMessage",
  component: SystemMessage,
};

export default meta;

type Story = StoryObj<typeof SystemMessage>;

export const Thinking: Story = {
  args: {
    animationType: "minimal",
    type: SystemMessageDataTypeEnum.Questions,
    isThinking: true,
    thinkingMessage: "Working through your request…",
    text: "Working through your request…",
    messageData: buildMessageData({
      type: SystemMessageDataTypeEnum.Questions,
      response: "Working through your request…",
    }),
  },
};

export const Failed: Story = {
  args: {
    animationType: "minimal",
    type: SystemMessageDataTypeEnum.Analysis,
    isFailed: true,
    errorMessage: "Couldn't load the assistant's response. Please try again.",
    retryState: noopRetryState,
  },
};

export const Populated: Story = {
  args: {
    animationType: "minimal",
    type: SystemMessageDataTypeEnum.Analysis,
    text: populatedText,
    enableTypingAnimation: false,
  },
};
