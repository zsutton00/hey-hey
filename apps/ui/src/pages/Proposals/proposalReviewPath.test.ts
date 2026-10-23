import type { ProposalResponseDto } from "@hey-hey/ui-common/api";
import { describe, expect, it, vi } from "vitest";
import { proposalReviewPath } from "./proposalReviewPath";

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    proposal: ({
      projectId,
      proposalId,
    }: {
      projectId: string;
      proposalId: string;
    }) => `/projects/${projectId}/proposals/${proposalId}`,
    proposalGroup: ({
      projectId,
      groupId,
    }: {
      projectId: string;
      groupId: string;
    }) => `/projects/${projectId}/proposal-groups/${groupId}`,
  },
}));

function proposal(
  overrides: Partial<ProposalResponseDto> = {},
): ProposalResponseDto {
  return {
    id: "proposal-id",
    ...overrides,
  } as ProposalResponseDto;
}

describe("proposalReviewPath", () => {
  it("uses persisted group membership for the canonical review destination", () => {
    expect(
      proposalReviewPath(
        "project-id",
        proposal({
          groupMembership: {
            groupId: "group-id",
            memberId: "member-id",
            memberOrder: 2,
            revision: 4,
            lifecycle: "REVIEWABLE",
          },
        }),
      ),
    ).toBe("/projects/project-id/proposal-groups/group-id");
  });

  it("preserves the individual proposal destination without membership", () => {
    expect(proposalReviewPath("project-id", proposal())).toBe(
      "/projects/project-id/proposals/proposal-id",
    );
  });
});
