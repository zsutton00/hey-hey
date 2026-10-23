import { describe, expect, it } from "vitest";
import {
  ProposalAction,
  type FutureRevisionContent,
  type FutureRevisionResponse,
  type ProposalResponseDto,
} from "../../../api";
import {
  futureAsUpdateProposal,
  futureBaselineContent,
  isFutureProposal,
  type FutureProposal,
} from "../futureAsUpdate";

const requirements = (statements: string[]) =>
  JSON.stringify({
    records: statements.map((statement, index) => ({
      id: `req-${index}`,
      statement,
      designedBy: [],
      fulfilledBy: [],
      contracts: [],
    })),
  });

const live: FutureRevisionContent = {
  id: "feature",
  organizationId: "org",
  projectId: "project",
  type: "FEATURE",
  name: "Open Items",
  status: "ACTIVE",
  source: "user",
  priority: "MEDIUM",
  parentTaskId: "parent",
  sections: [
    {
      id: "s1",
      key: "description",
      order: 0,
      materializedMarkdown: "Same description",
      materializedProposalId: "p0",
    },
    {
      id: "s2",
      key: "requirements",
      order: 1,
      materializedMarkdown: requirements(["Existing"]),
      materializedProposalId: "p0",
    },
  ],
};

const future = (
  result: FutureRevisionContent,
  extra: Partial<ProposalResponseDto> = {},
): FutureProposal =>
  ({
    id: "future-proposal",
    organizationId: "org",
    projectId: "project",
    type: "SINGLE",
    action: ProposalAction.VersionedUpdate,
    status: "DRAFT",
    targetEntityId: "feature",
    targetEntityType: "TASK",
    updates: {
      operation: "REVISE",
      futureId: "future",
      expectedRevision: 0,
      baseline: { kind: "LIVE", revision: "r1", content: live },
      result,
      dependencies: new Set(),
    },
    requestorId: "user",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-10-22T00:00:00Z",
    updatedAt: "2026-10-22T00:00:00Z",
    ...extra,
  }) as FutureProposal;

describe("futureAsUpdateProposal", () => {
  it("keeps only changed fields so unchanged title and status are not shown", () => {
    const added = requirements(["Existing", "Cap at 100"]);
    const proposal = future({
      ...live,
      sections: [
        live.sections[0],
        { ...live.sections[1], materializedMarkdown: added },
      ],
    } as FutureRevisionContent);

    expect(isFutureProposal(proposal)).toBe(true);
    const projected = futureAsUpdateProposal(proposal, live);

    expect(projected.action).toBe(ProposalAction.Update);
    expect(projected.updates).toEqual({
      sections: [{ key: "requirements", order: 1, content: added }],
    });
  });

  it("reports changed scalar fields, including a new parent", () => {
    const projected = futureAsUpdateProposal(
      future({ ...live, name: "Open Items v2", parentTaskId: "other" }),
      live,
    );
    expect(projected.updates).toEqual({
      name: "Open Items v2",
      parentTaskId: "other",
    });
  });

  it("projects a cancellation to an empty update", () => {
    const proposal = {
      ...future(live),
      updates: { operation: "CANCEL", futureId: "future", expectedRevision: 1 },
    } as unknown as FutureProposal;
    expect(futureAsUpdateProposal(proposal, live).updates).toEqual({});
  });
});

describe("futureBaselineContent", () => {
  const approved = {
    latestProposalId: "earlier",
    result: { ...live, name: "Approved future name" },
  } as FutureRevisionResponse;

  it("compares a pending refinement with the approved future", () => {
    expect(
      futureBaselineContent(future(live, { reviewedFuture: approved }), live),
    ).toBe(approved.result);
  });

  it("compares a new or approved future with the live target", () => {
    expect(futureBaselineContent(future(live), live)).toBe(live);
    expect(
      futureBaselineContent(
        future(live, { reviewedFuture: approved, status: "APPROVED" }),
        live,
      ),
    ).toBe(live);
  });
});
