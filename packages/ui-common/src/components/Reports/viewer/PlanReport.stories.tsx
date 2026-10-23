import type { Meta, StoryObj } from "@storybook/react";
import {
  PlanReportSeverity,
  PlanReportSourceType,
  ReportAudience,
  ReportType,
  type PlanReportPayload,
  type ReportDto,
} from "../../../api";
import { PlanReport } from "./PlanReport";

const buildReport = (payload: PlanReportPayload): ReportDto =>
  ({
    id: "story-plan",
    organizationId: "org-1",
    reportType: ReportType.Plan,
    audience: ReportAudience.WorkflowOnly,
    title: "PLAN report",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
  } as ReportDto);

const meta: Meta<typeof PlanReport> = {
  title: "Components/Reports/PlanReport",
  component: PlanReport,
};

export default meta;

type Story = StoryObj<typeof PlanReport>;

const summaryOnlyPayload: PlanReportPayload = {
  reportType: "PLAN",
  summary:
    "Drafted the PLAN renderer skeleton. The dispatcher will route PLAN reports to a typed renderer composed against the shared report primitives once the typed sections land.",
  sessionTitle: "Typed PLAN renderer rollout",
  primaryImplementations: [
    {
      title: "Typed report presentation",
      content: "Render the generated payload through shared report primitives.",
      rationale:
        "Keeps the report useful while the remaining sections are empty.",
    },
  ],
  executionPlan: [],
  discrepancies: [],
  clarificationQuestions: [],
};

const typicalPayload: PlanReportPayload = {
  reportType: "PLAN",
  summary:
    "Added the PLAN typed renderer and wired it into ReportViewer.tsx. Extended the dispatcher test with a PLAN fixture alongside SNAPSHOT, VALIDATION_WALKTHROUGH, and IMPLEMENT.",
  sessionTitle: "Typed PLAN renderer rollout",
  primaryImplementations: [
    {
      title: "Typed PLAN renderer",
      content:
        "Present **primary implementations** before the globally ordered execution steps.",
      rationale:
        "Reviewers see the proposed outcome before implementation sequencing.",
      location: "src/components/Reports/viewer/PlanReport.tsx",
    },
  ],
  executionPlan: [
    {
      stepId: "step-1",
      title: "Author the typed PlanReport renderer",
      description:
        "Compose summary, sessionTitle, executionPlan, discrepancies, and clarificationQuestions sections from the shared primitives.",
      phase: 1,
      targetFiles: ["src/components/Reports/viewer/PlanReport.tsx"],
      references: [
        {
          sourceType: PlanReportSourceType.Task,
          sourceId: "6134cfc4-4b57-491e-9804-861d7153be2c",
          rationale: "Primary task driving this renderer.",
        },
      ],
    },
  ],
  discrepancies: [
    {
      sourceRef: {
        sourceType: PlanReportSourceType.Task,
        sourceId: "6134cfc4-4b57-491e-9804-861d7153be2c",
      },
      sourceField: "description",
      sourceExcerpt: "getReportRenderer switch",
      discrepancyText: "Dispatcher identifier is stale",
      reasoning:
        "The dispatcher is named renderReportBody in ReportViewer.tsx; the description's getReportRenderer reference is stale.",
      severity: PlanReportSeverity.Low,
    },
  ],
  clarificationQuestions: [
    {
      question: "Should references render inline or in a nested list?",
      reason:
        "The plan description supports both presentation options; pick one for the typed surface.",
    },
  ],
};

const fullPayload: PlanReportPayload = {
  reportType: "PLAN",
  summary:
    "Implemented the PLAN renderer with the full payload surface — summary, sessionTitle, execution-plan cards with references, discrepancy cards carrying severity, and clarification questions with related sources.",
  sessionTitle: "Typed PLAN renderer rollout",
  primaryImplementations: [
    {
      title: "Shared implementation cards",
      content:
        "interface PrimaryImplementation {\n  title: string;\n  content: string;\n}",
      rationale: "Both approval and report surfaces consume one presentation.",
      location: "src/components/CodingPlan/PrimaryImplementationList.tsx",
      language: "typescript",
      connections: [
        {
          entityType: "contract",
          entityId: "b74388c0-f605-405a-937c-f9035d9de0e3",
          entityTitle: "Report mention rendering contract",
          relationship: "enforces",
          sourceField: "requirements[0]",
          sourceExcerpt: "Structured entity identities use mention primitives.",
          rationale:
            "The connection identity remains navigable in PLAN reports.",
        },
      ],
    },
    {
      title: "Flat execution sequence",
      content: "Render steps once in payload order without phase headings.",
      rationale: "Phase remains metadata and no longer changes presentation.",
    },
  ],
  executionPlan: [
    {
      stepId: "step-1",
      title: "Author the typed PlanReport renderer",
      description:
        "Compose summary, sessionTitle, and the three array sections from the shared primitives.",
      phase: 1,
      targetFiles: [
        "src/components/Reports/viewer/PlanReport.tsx",
        "src/components/Reports/viewer/index.ts",
      ],
      references: [
        {
          sourceType: PlanReportSourceType.Task,
          sourceId: "6134cfc4-4b57-491e-9804-861d7153be2c",
          rationale: "Primary task driving this renderer.",
        },
        {
          sourceType: PlanReportSourceType.DesignDoc,
          sourceId: "design-doc-1",
          rationale: "Shared primitives contract.",
        },
      ],
    },
    {
      stepId: "step-2",
      title: "Wire PLAN into the ReportViewer dispatcher",
      description:
        "Add a PLAN case to the renderReportBody switch in ReportViewer.tsx and import the typed payload alongside the other narrowed payloads.",
      phase: 2,
      targetFiles: ["src/components/Reports/ReportViewer.tsx"],
      references: [
        {
          sourceType: PlanReportSourceType.Task,
          sourceId: "6134cfc4-4b57-491e-9804-861d7153be2c",
          rationale: "Acceptance criterion routes PLAN to the typed renderer.",
        },
      ],
    },
  ],
  discrepancies: [
    {
      sourceRef: {
        sourceType: PlanReportSourceType.Task,
        sourceId: "6134cfc4-4b57-491e-9804-861d7153be2c",
      },
      sourceField: "description",
      sourceExcerpt: "getReportRenderer switch",
      discrepancyText: "Dispatcher identifier is stale",
      reasoning:
        "The dispatcher is named renderReportBody; the description's getReportRenderer reference is stale.",
      severity: PlanReportSeverity.Low,
    },
    {
      sourceRef: {
        sourceType: PlanReportSourceType.Task,
        sourceId: "6134cfc4-4b57-491e-9804-861d7153be2c",
      },
      sourceExcerpt: "stage- or step-list arrays",
      discrepancyText: "Concrete array fields differ from the prose",
      reasoning:
        "PlanReportPayload exposes executionPlan, discrepancies, and clarificationQuestions; the description's generic wording undercounts the surface.",
      severity: PlanReportSeverity.Low,
    },
  ],
  clarificationQuestions: [
    {
      question: "Should references render inline or in a nested list?",
      reason:
        "The plan description supports both presentation options; pick one for the typed surface.",
      relatedSourceRefs: [
        {
          sourceType: PlanReportSourceType.Task,
          sourceId: "6134cfc4-4b57-491e-9804-861d7153be2c",
        },
      ],
    },
    {
      question: "Are sourceField annotations expected on every discrepancy?",
      reason:
        "Some discrepancies in fixtures omit sourceField; confirm whether the renderer should hide the annotation when missing.",
    },
  ],
};

export const SummaryOnly: Story = {
  args: {
    report: buildReport(summaryOnlyPayload),
    payload: summaryOnlyPayload,
    reportTestId: "story-plan-summary-only",
  },
};

export const TypicalPayload: Story = {
  args: {
    report: buildReport(typicalPayload),
    payload: typicalPayload,
    reportTestId: "story-plan-typical",
  },
};

export const FullPayload: Story = {
  args: {
    report: buildReport(fullPayload),
    payload: fullPayload,
    reportTestId: "story-plan-full",
  },
};
