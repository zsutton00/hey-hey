import type { Meta, StoryObj } from "@storybook/react";
import {
  ReportAudience,
  ReportType,
  type GoalProgressReportPayload,
  type ReportDto,
} from "../../../api";
import { GoalProgressReport } from "./GoalProgressReport";

const buildReport = (payload: GoalProgressReportPayload): ReportDto =>
  ({
    id: "story-goal-progress",
    organizationId: "org-1",
    reportType: ReportType.GoalProgress,
    audience: ReportAudience.WorkflowOnly,
    title: "GOAL_PROGRESS report",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
  } as ReportDto);

const meta: Meta<typeof GoalProgressReport> = {
  title: "Components/Reports/GoalProgressReport",
  component: GoalProgressReport,
};

export default meta;

type Story = StoryObj<typeof GoalProgressReport>;

const anchoredPayload: GoalProgressReportPayload = {
  reportType: "GOAL_PROGRESS",
  summary:
    "Closed two of the four execution steps that gate the typed renderer rollout. Remaining work is concentrated in the dispatcher wiring and the cross-surface validation sweep; both are owned by sibling tasks under the same parent feature.",
  title: "Typed renderer rollout — progress",
  text: "The GoalProgress renderer now composes ReportLabeledText, ReportPanel, and ReportEntityMention primitives to match the visual hierarchy convention used by the other typed renderers. Summary, title, and text are surfaced through ReportLabeledText with inline mention rendering on the text fields. When the payload carries a goal anchor, the renderer surfaces a clickable mention so reviewers can navigate to the underlying Goal task from the activity detail and ReportsList surfaces.",
  goalAnchor: {
    entityType: "GOAL",
    entityId: "6e671950-78ff-41fc-b001-1e1378b6e41a",
  },
};

export const WithGoalAnchor: Story = {
  args: {
    report: buildReport(anchoredPayload),
    payload: anchoredPayload,
    reportTestId: "story-goal-progress-anchored",
  },
};

const unanchoredPayload: GoalProgressReportPayload = {
  reportType: "GOAL_PROGRESS",
  summary:
    "Captured progress against a goal that is not yet linked to a concrete Goal task. The renderer omits the anchor block entirely rather than rendering an empty panel.",
  text: "Walking the feature subtree surfaced enough signal to draft a progress update, but the parent Goal entity does not yet exist. The agent will revisit attachment after the cross-surface validation step lands.",
};

export const WithoutGoalAnchor: Story = {
  args: {
    report: buildReport(unanchoredPayload),
    payload: unanchoredPayload,
    reportTestId: "story-goal-progress-unanchored",
  },
};
