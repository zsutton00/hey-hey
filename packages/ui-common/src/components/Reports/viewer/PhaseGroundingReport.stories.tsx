import type { Meta, StoryObj } from "@storybook/react";
import {
  ReportAudience,
  ReportType,
  type PhaseGroundingReportPayload,
  type ReportDto,
} from "../../../api";
import { PhaseGroundingReport } from "./PhaseGroundingReport";

const buildReport = (payload: PhaseGroundingReportPayload): ReportDto =>
  ({
    id: "story-phase-grounding",
    organizationId: "org-1",
    reportType: ReportType.PhaseGrounding,
    audience: ReportAudience.WorkflowOnly,
    title: "PHASE_GROUNDING report",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
  } as ReportDto);

const meta: Meta<typeof PhaseGroundingReport> = {
  title: "Components/Reports/PhaseGroundingReport",
  component: PhaseGroundingReport,
};

export default meta;

type Story = StoryObj<typeof PhaseGroundingReport>;

const singleTouchPointPayload: PhaseGroundingReportPayload = {
  reportType: "PHASE_GROUNDING",
  summary:
    "About to author the typed PHASE_GROUNDING renderer. The phase touches a single new file and composes the existing report primitives — no contract changes are implied beyond adding the renderer itself.",
  touchPoints: [
    {
      file: "src/components/Reports/viewer/PhaseGroundingReport.tsx",
      expectedOutcome:
        "Create the typed renderer composing ReportLabeledText, ReportPanel, and ReportItemCard from the shared primitives.",
    },
  ],
};

const multiTouchPointPayload: PhaseGroundingReportPayload = {
  reportType: "PHASE_GROUNDING",
  summary:
    "Grounding the wiring phase: the renderer is exported, dispatched, and covered by a story and a dispatch test. One touch point diverges from the approved plan because the narrow switch already includes PhaseGrounding.",
  planAdjustment:
    "The approved plan listed a change to rendererContract.ts, but PhaseGrounding is already present in the narrowReportPayload switch, so that touch point is dropped.",
  touchPoints: [
    {
      file: "src/components/Reports/viewer/index.ts",
      expectedOutcome:
        "Re-export PhaseGroundingReport from the viewer barrel so the dispatcher can import it.",
    },
    {
      file: "src/components/Reports/ReportViewer.tsx",
      expectedOutcome:
        "Add a case ReportType.PhaseGrounding arm rendering the typed renderer with the payload cast.",
    },
    {
      file: "src/components/Reports/viewer/rendererContract.ts",
      expectedOutcome:
        "Confirm PhaseGrounding resolves through narrowReportPayload.",
      divergenceFromInitialPlan:
        "No edit needed — PhaseGrounding is already listed in the narrow switch, so this touch point becomes a read-only confirmation rather than a change.",
    },
  ],
};

export const SingleTouchPoint: Story = {
  args: {
    report: buildReport(singleTouchPointPayload),
    payload: singleTouchPointPayload,
    reportTestId: "story-phase-grounding-single",
  },
};

export const MultiTouchPoint: Story = {
  args: {
    report: buildReport(multiTouchPointPayload),
    payload: multiTouchPointPayload,
    reportTestId: "story-phase-grounding-multi",
  },
};
