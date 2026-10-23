import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type PlanGenerationVisualPreviewPayload,
  type ProposalResponseDto,
} from "../../../api";
import { describe, expect, it } from "vitest";
import { resolvePlanGenerationVisualPreview } from "./planGenerationVisualPreviewUtils";

const createProposal = (
  id: string,
  title: string,
  createdAt: string,
): ProposalResponseDto => ({
  id,
  organizationId: "organization-1",
  projectId: "project-1",
  type: ProposalType.Single,
  action: ProposalAction.Create,
  status: ProposalStatus.Draft,
  targetEntityId: `target-${id}`,
  targetEntityType: TargetEntityType.Task,
  title,
  updates: { name: title },
  requestorId: "requestor-1",
  requiredApprovals: 1,
  approvals: [],
  createdAt,
  updatedAt: createdAt,
});

const payload: PlanGenerationVisualPreviewPayload = {
  responseType: "plan_generation_visual_preview_v1",
  entries: [
    {
      proposalId: "diagram-detail",
      artifactFamily: "diagram",
      presentationOrder: 2,
      relationship: {
        kind: "refines",
        proposalId: "diagram-overview",
      },
    },
    {
      proposalId: "mockup-list",
      artifactFamily: "mockup",
      presentationOrder: 0,
    },
    {
      proposalId: "diagram-overview",
      artifactFamily: "diagram",
      presentationOrder: 1,
    },
  ],
};

const proposals = [
  createProposal("diagram-detail", "Diagram detail", "2026-01-01T00:00:00Z"),
  createProposal(
    "diagram-overview",
    "Diagram overview",
    "2026-01-03T00:00:00Z",
  ),
  createProposal("mockup-list", "Mockup list", "2026-01-02T00:00:00Z"),
];

describe("resolvePlanGenerationVisualPreview", () => {
  it("uses explicit presentation order and retains relationship metadata", () => {
    const result = resolvePlanGenerationVisualPreview(payload, proposals);

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    expect(result.entries.map(({ proposal }) => proposal.id)).toEqual([
      "mockup-list",
      "diagram-overview",
      "diagram-detail",
    ]);
    expect(result.entries[2].entry.relationship).toEqual({
      kind: "refines",
      proposalId: "diagram-overview",
    });
  });

  it("reports a proposal that was not loaded for an entry", () => {
    const result = resolvePlanGenerationVisualPreview(
      payload,
      proposals.slice(1),
    );

    expect(result).toEqual({
      kind: "error",
      message: "A visual preview proposal could not be loaded.",
    });
  });

  it("rejects relationships that cross artifact families", () => {
    const result = resolvePlanGenerationVisualPreview(
      {
        ...payload,
        entries: payload.entries.map((entry) =>
          entry.proposalId === "diagram-detail"
            ? {
                ...entry,
                relationship: {
                  kind: "depends_on",
                  proposalId: "mockup-list",
                },
              }
            : entry,
        ),
      },
      proposals,
    );

    expect(result).toEqual({
      kind: "error",
      message:
        "Visual preview relationships must target another visual in the same family.",
    });
  });
});
