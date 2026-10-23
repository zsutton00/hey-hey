import { proposalKeys } from "../proposals";
import { describe, expect, it } from "vitest";
import {
  isProposalGroupLifecycleEventForScope,

} from "../proposalGroups";

describe("proposalGroups collection", () => {
  it("scopes canonical reads by organization, project, and group", () => {
    expect(
      proposalKeys.group("org-1", "project-1", "group-1")
    ).toEqual(["proposals", "org-1", "project-1", "group", "group-1"]);
  });

  it("matches lifecycle invalidations by the complete canonical scope", () => {
    const event = {
      type: "proposal_group.lifecycle" as const,
      timestamp: "2026-07-27T00:00:00Z",
      organizationId: "org-1",
      projectId: "project-1",
      groupId: "group-1",
      revision: 5,
      changedMemberIds: new Set(["member-1"]),
    };
    const scope = {
      organizationId: "org-1",
      projectId: "project-1",
      groupId: "group-1",
    };

    expect(isProposalGroupLifecycleEventForScope(event, scope)).toBe(true);
    expect(
      isProposalGroupLifecycleEventForScope(event, {
        ...scope,
        groupId: "group-2",
      })
    ).toBe(false);
  });
});
