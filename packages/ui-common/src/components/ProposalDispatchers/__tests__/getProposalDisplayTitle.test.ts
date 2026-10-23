import { describe, expect, it } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
} from "../../../api";
import { getProposalDisplayTitle } from "../getProposalDisplayTitle";

function makeProposal(
  overrides: Partial<ProposalResponseDto>
): ProposalResponseDto {
  return {
    id: "proposal-1",
    organizationId: "org-1",
    projectId: "proj-1",
    type: ProposalType.Single,
    action: ProposalAction.Delete,
    status: ProposalStatus.Pending,
    targetEntityId: "entity-1",
    targetEntityType: TargetEntityType.Task,
    updates: {},
    requestorId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as unknown as ProposalResponseDto;
}

describe("getProposalDisplayTitle", () => {
  it("returns the proposal.title snapshot field when it is a non-empty string", () => {
    const proposal = makeProposal({
      title: "Snapshot Title",
      updates: { name: "Updates Name" } as never,
    });
    expect(getProposalDisplayTitle(proposal)).toBe("Snapshot Title");
  });

  it("falls back to the updates title keys when proposal.title is null", () => {
    const proposal = makeProposal({
      title: null,
      updates: { name: "Updates Name" } as never,
    });
    expect(getProposalDisplayTitle(proposal)).toBe("Updates Name");
  });

  it("ignores a blank proposal.title and falls back to updates", () => {
    const proposal = makeProposal({
      title: "   ",
      updates: { title: "From Updates" } as never,
    });
    expect(getProposalDisplayTitle(proposal)).toBe("From Updates");
  });

  it("falls back to readable action and entity-type text when nothing else resolves", () => {
    const proposal = makeProposal({ title: null, updates: {} as never });
    expect(getProposalDisplayTitle(proposal)).toBe("Delete Task");
  });
});
