import type { Meta, StoryObj } from "@storybook/react";
import {
  EntityType,
  ReportAudience,
  ReportType,
  type CodingResearchReportPayload,
  type ReportDto,
} from "../../../api";
import { CodingResearchReport } from "./CodingResearchReport";

const buildReport = (payload: CodingResearchReportPayload): ReportDto =>
  ({
    id: "story-coding-research",
    organizationId: "org-1",
    projectId: "project-1",
    reportType: ReportType.CodingResearch,
    audience: ReportAudience.WorkflowOnly,
    title: "Research report fixture",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
  } as ReportDto);

const meta: Meta<typeof CodingResearchReport> = {
  title: "Components/Reports/CodingResearchReport",
  component: CodingResearchReport,
};

export default meta;

type Story = StoryObj<typeof CodingResearchReport>;

const fullPayload: CodingResearchReportPayload = {
  reportType: "CODING_RESEARCH",
  summary:
    "Surveyed the typed-renderer surface and confirmed the report keeps its short handoff visible first. Proposed changes appear above Analysis in a distinct review section, with proposal-style entity identities and a clearly explained conversation action beneath the cards. Analysis opens on demand and Research details appears only while Analysis is open. The structured frame presents linked entity headings with compact type and source badges, preserving both discovery history and traversed graph edges without exposing a serialized payload.",
  analysis:
    "The viewer presents the full report payload through shared report primitives. **Summary stays visible while Analysis starts collapsed.**\n\n- Research frame nodes use canonical entity links and compact metadata.\n- Each outgoing target is followed by its relationship chip.\n- Frame nodes, discovery calls, and traversed edges appear in the collapsed Research details section only while Analysis is open.",
  frame: {
    focalId: "2533ce2a-653e-46c1-a3eb-bc2039d85c97",
    nodes: [
      {
        id: "2533ce2a-653e-46c1-a3eb-bc2039d85c97",
        type: EntityType.Task,
        title: "Improve CODING_RESEARCH renderer",
        content:
          "Keep summary and analysis visible while presenting the supporting research frame as structured cards.",
        contentSource: "original",
        edges: [
          {
            toId: "176dd18c-a7bf-474f-9445-3e0d5af0d29b",
            type: "depends_on",
            reasoning:
              "The renderer must preserve the shared typed report viewer contract.",
          },
        ],
      },
      {
        id: "176dd18c-a7bf-474f-9445-3e0d5af0d29b",
        type: EntityType.DesignDoc,
        title: "Reports viewer renderer contract",
        content:
          "Narrow the report payload once and compose the shared report primitives.",
        contentSource: "extracted",
        edges: [],
      },
    ],
  },
  provenance: {
    discoveryCalls: [
      {
        tool: "unified_search",
        query: "CodingResearchReport renderer",
        intent:
          "Locate the existing renderer component to understand its current shape.",
      },
      {
        tool: "get_context",
        query: "task-b0fd14d9-a762-4a9e-9e14-3786467b5e58",
        intent:
          "Retrieve task context to understand scope and acceptance criteria.",
      },
    ],
    edgesTraversed: [
      {
        fromId: "feature-reports",
        toId: "task-b0fd14d9",
        reasoning:
          "Task belongs to the Reports feature — needed to understand the surrounding feature context.",
      },
    ],
  },
  updates: [
    {
      type: "add",
      targets: [
        {
          entityType: EntityType.Task,
          entityId: "2533ce2a-653e-46c1-a3eb-bc2039d85c97",
          title: "Improve CODING_RESEARCH renderer",
        },
        {
          entityType: EntityType.DesignDoc,
          entityId: "176dd18c-a7bf-474f-9445-3e0d5af0d29b",
          title: "Reports viewer renderer contract",
        },
      ],
      description: "Add the renderer requirement to the report contract.",
      reason:
        "The research frame identifies both entities as the relevant implementation context.",
    },
  ],
};

export const FullPayload: Story = {
  args: {
    report: buildReport(fullPayload),
    payload: fullPayload,
    reportTestId: "story-coding-research",
  },
};

const emptyPayload: CodingResearchReportPayload = {
  reportType: "CODING_RESEARCH",
  summary:
    "This fixture demonstrates defined empty states for a research report that has no frame nodes, discovery calls, or graph edges. Summary is visible first; Analysis and its Research details section open on demand, with clear empty messages inside the details.",
  analysis: "The feature has no prior implementation. Starting from scratch.",
  frame: {
    focalId: "2533ce2a-653e-46c1-a3eb-bc2039d85c97",
    nodes: [],
  },
  provenance: {
    discoveryCalls: [],
    edgesTraversed: [],
  },
  updates: [],
};

export const EmptyState: Story = {
  args: {
    report: buildReport(emptyPayload),
    payload: emptyPayload,
    reportTestId: "story-coding-research-empty",
  },
};
