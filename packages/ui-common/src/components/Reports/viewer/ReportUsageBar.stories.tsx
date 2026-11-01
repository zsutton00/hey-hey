import type { Meta, StoryObj } from "@storybook/react";
import {
  ReportUsageBreakdownEntryRoleEnum,
  ReportUsageCacheAvailability,
  ReportUsageCoverage,
  type ReportUsageMeasurement,
} from "../../../api";
import { ReportUsageBar } from "./ReportUsageBar";

const completeUsage: ReportUsageMeasurement = {
  schemaVersion: 1,
  runId: "run-1",
  agentSessionId: "run-1",
  providerSessionId: "native-parent",
  effort: null,
  capturedAt: "2026-05-15T00:00:00.000Z",
  executionId: "exec-1",
  turnId: "turn-1",
  provider: "anthropic",
  model: "claude-opus",
  inputTokens: 12_400,

  freshInputTokens: 3_300,
  cacheReadInputTokens: 8_000,
  cacheCreationInputTokens: 1_100,
  cacheAvailability: ReportUsageCacheAvailability.Reported,
  outputTokens: 1_200,
  toolCalls: 14,
  coverage: ReportUsageCoverage.Complete,
  breakdown: [
    {
      role: ReportUsageBreakdownEntryRoleEnum.Parent,
      label: "Implementer",
      executionId: "exec-1",
      providerSessionId: "native-parent",
      provider: "claude",
      model: null,
      effort: null,
      inputTokens: 9_000,

      freshInputTokens: 2_000,
      cacheReadInputTokens: 6_500,
      cacheCreationInputTokens: 500,
      cacheAvailability: ReportUsageCacheAvailability.Reported,
      outputTokens: 900,
      toolCalls: 10,
      coverage: ReportUsageCoverage.Complete,
    },
    {
      role: ReportUsageBreakdownEntryRoleEnum.Subagent,
      label: "Explore",
      executionId: "child-1",
      providerSessionId: "native-child",
      provider: "claude",
      model: null,
      effort: null,
      inputTokens: 3_400,

      freshInputTokens: 1_300,
      cacheReadInputTokens: 1_500,
      cacheCreationInputTokens: 600,
      cacheAvailability: ReportUsageCacheAvailability.Reported,
      outputTokens: 300,
      toolCalls: 4,
      coverage: ReportUsageCoverage.Complete,
    },
  ],
};

const meta: Meta<typeof ReportUsageBar> = {
  title: "Components/Reports/ReportUsageBar",
  component: ReportUsageBar,
};

export default meta;

type Story = StoryObj<typeof ReportUsageBar>;

export const Complete: Story = { args: { usage: completeUsage } };

export const Partial: Story = {
  args: {
    usage: {
      ...completeUsage,
      coverage: ReportUsageCoverage.Partial,
      toolCalls: null,
    },
  },
};

export const UsageUnavailable: Story = { args: { usage: null } };

export const CacheUnreported: Story = {
  args: {
    usage: {
      ...completeUsage,
      inputTokens: null,

      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      cacheAvailability: ReportUsageCacheAvailability.Unreported,
      breakdown: [],
    },
  },
};

export const MeasuredZero: Story = {
  args: {
    usage: {
      ...completeUsage,
      inputTokens: 0,
      freshInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
      toolCalls: 0,
      breakdown: [],
    },
  },
};
