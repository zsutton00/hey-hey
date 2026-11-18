import { Box, ThemeProvider } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import {
  ReportAudience,
  ReportType,
  type FeatureSyncDecisionReportPayload,
  type FeatureSyncDecisionReportPayloadV2,
  type ReportDto,
} from "../../../api";
import { FeatureSyncDecisionReport } from "./FeatureSyncDecisionReport";

const buildReport = (payload: FeatureSyncDecisionReportPayload): ReportDto =>
  ({
    id: "story-feature-sync-decision",
    organizationId: "org-1",
    reportType: ReportType.FeatureSyncDecision,
    audience: ReportAudience.ProjectVisible,
    title: "FEATURE_SYNC_DECISION report",
    payload,
    version: 1,
    schemaVersion: "decisionGroups" in payload ? 2 : 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-06-28T00:00:00.000Z",
    expiresAt: "2026-07-28T00:00:00.000Z",
    entities: [],
  }) as ReportDto;

const meta: Meta<typeof FeatureSyncDecisionReport> = {
  title: "Components/Reports/FeatureSyncDecisionReport",
  component: FeatureSyncDecisionReport,
  // Show every story in the Hey light and dark themes so both can be checked.
  decorators: [
    (Story) => (
      <>
        {(["light", "dark"] as const).map((mode) => (
          <ThemeProvider key={mode} theme={createHeyTheme(mode)}>
            <Box
              sx={{
                bgcolor: "background.default",
                p: 2,
                color: "text.primary",
              }}
            >
              <Story />
            </Box>
          </ThemeProvider>
        ))}
      </>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof FeatureSyncDecisionReport>;

const summaryOnlyPayload: FeatureSyncDecisionReportPayload = {
  reportType: "FEATURE_SYNC_DECISION",
  summary: "No discrepancies were flagged during feature sync analysis.",
  discrepancies: [],
  reconciliationOptions: [],
};

const typicalPayload: FeatureSyncDecisionReportPayload = {
  reportType: "FEATURE_SYNC_DECISION",
  summary:
    "Feature sync analysis identified two discrepancies with proposed reconciliation options.",
  discrepancies: [
    {
      sourceType: "TASK",
      source: {
        entityType: "TASK",
        entityId: "76d3266c-9484-4214-b828-3358e9412330",
        title: "Typed FEATURE_SYNC renderer",
      },
      description: "Task description references the wrong dispatcher name.",
    },
  ],
  reconciliationOptions: [
    {
      description: "Edit the task description to match the dispatcher name.",
      discrepancyIndices: [0],
    },
  ],
};

const fullPayload: FeatureSyncDecisionReportPayload = {
  reportType: "FEATURE_SYNC_DECISION",
  summary:
    "Feature sync analysis surfaced three discrepancies across tasks and features with multiple reconciliation paths including combined options that resolve multiple items.",
  discrepancies: [
    {
      sourceType: "TASK",
      source: {
        entityType: "TASK",
        entityId: "76d3266c-9484-4214-b828-3358e9412330",
        title: "Typed FEATURE_SYNC renderer",
      },
      description: "Task description references the wrong dispatcher name.",
    },
    {
      sourceType: "FEATURE",
      source: {
        entityType: "FEATURE",
        entityId: "6e671950-78ff-41fc-b001-1e1378b6e41a",
        title: "Reports",
      },
      description: "Feature requirements omit rendering capability.",
    },
    {
      sourceType: "TASK",
      source: {
        entityType: "TASK",
        entityId: "12345678-1234-1234-1234-123456789012",
        title: "ReportViewer header control",
      },
      description: "Task scope overlaps with sibling task.",
    },
  ],
  reconciliationOptions: [
    {
      description: "Edit the task description to match the dispatcher name.",
      discrepancyIndices: [0],
    },
    {
      description: "Add rendering requirement to the Reports feature.",
      discrepancyIndices: [1],
    },
    {
      description: "Merge overlapping task scopes into a single cohesive task.",
      discrepancyIndices: [2],
    },
    {
      description:
        "Comprehensive fix: update all three entities to align with the established rendering contract and resolve scope overlap.",
      discrepancyIndices: [0, 1, 2],
    },
  ],
};

const groupedPayload: FeatureSyncDecisionReportPayloadV2 = {
  reportType: "FEATURE_SYNC_DECISION",
  summary:
    "Feature Sync surfaced two independent decisions that are ready for review.",
  decisionGroups: [
    {
      id: "report-presentation",
      affectedEntities: [
        {
          entityType: "task",
          entityId: "76d3266c-9484-4214-b828-3358e9412330",
          title: "Typed FEATURE_SYNC renderer",
        },
      ],
      title: "Report presentation",
      summary: "Choose whether to keep the report presentation as-is.",
      choices: [
        {
          id: "keep-presentation",
          label: "Keep the current presentation",
          isNoChange: true,
        },
        {
          id: "update-presentation",
          label: "Update the presentation",
          description: "Apply the producer-authored presentation change.",
          isNoChange: false,
        },
      ],
    },
    {
      id: "report-follow-up",
      affectedEntities: [
        {
          entityType: "feature",
          entityId: "6e671950-78ff-41fc-b001-1e1378b6e41a",
          title: "Reports",
        },
      ],
      title: "Follow-up response",
      summary: "Choose how to continue the discussion.",
      choices: [
        {
          id: "continue-conversation",
          label: "Continue in conversation",
          isNoChange: false,
        },
        {
          id: "no-follow-up",
          label: "No change",
          isNoChange: true,
        },
      ],
    },
  ],
};

export const SummaryOnly: Story = {
  args: {
    report: buildReport(summaryOnlyPayload),
    payload: summaryOnlyPayload,
    reportTestId: "story-feature-sync-decision-summary-only",
  },
};

export const TypicalPayload: Story = {
  args: {
    report: buildReport(typicalPayload),
    payload: typicalPayload,
    reportTestId: "story-feature-sync-decision-typical",
  },
};

export const FullPayload: Story = {
  args: {
    report: buildReport(fullPayload),
    payload: fullPayload,
    reportTestId: "story-feature-sync-decision-full",
  },
};

export const GroupedV2Payload: Story = {
  args: {
    payload: groupedPayload,
    report: buildReport(groupedPayload),
    reportTestId: "story-feature-sync-decision-grouped-v2",
  },
};

const [firstGroup, secondGroup] = groupedPayload.decisionGroups;

const singleGroupWithReasonsPayload: FeatureSyncDecisionReportPayloadV2 = {
  reportType: "FEATURE_SYNC_DECISION",
  summary: "The report renderer task and the Reports feature disagree.",
  decisionGroups: [
    {
      ...firstGroup,
      affectedEntities: [
        {
          ...firstGroup.affectedEntities[0],
          reason: "Its description names a dispatcher that no longer exists.",
        },
        {
          entityType: "feature",
          entityId: "6e671950-78ff-41fc-b001-1e1378b6e41a",
          title: "Reports",
          reason: "Its requirements promise the current presentation.",
        },
      ],
    },
  ],
};

const mixedReasonsPayload: FeatureSyncDecisionReportPayloadV2 = {
  ...groupedPayload,
  decisionGroups: [
    {
      ...firstGroup,
      affectedEntities: [
        {
          ...firstGroup.affectedEntities[0],
          reason: "Its description names a dispatcher that no longer exists.",
        },
      ],
    },
    secondGroup,
  ],
};

const storyInteraction = {
  conversationId: "story-conversation",
  disabled: false,
  parentMessageId: "story-message",
  submit: () => undefined,
};

export const SingleGroupWithReasons: Story = {
  args: {
    payload: singleGroupWithReasonsPayload,
    report: buildReport(singleGroupWithReasonsPayload),
    reportTestId: "story-feature-sync-decision-single-reasons",
    interaction: storyInteraction,
  },
};

export const MixedReasonsAndNoReasons: Story = {
  args: {
    payload: mixedReasonsPayload,
    report: buildReport(mixedReasonsPayload),
    reportTestId: "story-feature-sync-decision-mixed-reasons",
    interaction: storyInteraction,
  },
};

export const ReadOnlyWithReasons: Story = {
  args: {
    payload: mixedReasonsPayload,
    report: buildReport(mixedReasonsPayload),
    reportTestId: "story-feature-sync-decision-read-only",
  },
};
