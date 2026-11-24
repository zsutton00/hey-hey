import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { Box } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import {
  ReportAudience,
  ReportType,
  SystemMessageDataTypeEnum,
  type ReportDto,
  type SystemMessageData,
} from "../../../api";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import type { MessageRetryState } from "../../../types/conversation";
import { InterstitialThought } from "../../LlmForms/Registry/InterstitialField";
import { SystemMessage } from "./SystemMessage";

const buildMessageData = (
  overrides: Partial<SystemMessageData> & Pick<SystemMessageData, "type">,
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

const inlineReport = {
  id: "story-inline-implement",
  organizationId: "org-1",
  reportType: ReportType.Implement,
  audience: ReportAudience.WorkflowOnly,
  title: "IMPLEMENT report",
  payload: {
    reportType: "IMPLEMENT",
    summary:
      "Your messages are now blue bubbles on the right; agent replies are plain text with reports on gray cards.",
    filesChanged: [],
  },
  version: 1,
  schemaVersion: 1,
  sourceExecutionId: "exec-1",
  createdAt: "2026-11-23T00:00:00.000Z",
  expiresAt: "2026-12-23T00:00:00.000Z",
  entities: [],
} as ReportDto;

/** Renders the story on the page background of the given theme. */
const onPage =
  (mode: "light" | "dark"): Decorator =>
  (Story) => {
    const theme = createHeyTheme(mode);
    return (
      <ThemeProvider theme={theme}>
        <Box
          sx={{
            bgcolor: theme.palette.background.default,
            color: theme.palette.text.primary,
            p: 3,
            width: 720,
          }}
        >
          <Story />
        </Box>
      </ThemeProvider>
    );
  };

export const PlainReplyDark: Story = {
  ...Populated,
  decorators: [onPage("dark")],
};

export const ReplyWithInlineReport: Story = {
  args: {
    animationType: "minimal",
    type: SystemMessageDataTypeEnum.Agent,
    text: "Done. Here is the summary of what changed.",
    enableTypingAnimation: false,
    inlineReports: [inlineReport],
  },
  decorators: [onPage("light")],
};

export const ReplyWithInlineReportDark: Story = {
  ...ReplyWithInlineReport,
  decorators: [onPage("dark")],
};

const interstitials = (
  <>
    <InterstitialThought
      isActive={false}
      messageType="AGENT"
      position="first"
      thought="Reading the message components and theme tokens."
      timestamp="2026-11-23T05:51:16.752Z"
    />
    <InterstitialThought
      isActive
      messageType="AGENT"
      position="last"
      thought="Swapping the bubble colors now."
      timestamp="2026-11-23T05:52:04.558Z"
    />
  </>
);

export const Interstitials: Story = {
  render: () => interstitials,
  decorators: [onPage("light")],
};

export const InterstitialsDark: Story = {
  render: () => interstitials,
  decorators: [onPage("dark")],
};
