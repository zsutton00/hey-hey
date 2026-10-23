import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TargetEntityType } from "@hey-hey/ui-common/api";

const discussCapsuleActionMock = vi.fn();

vi.mock("@hey-hey/ui-common/components", () => ({
  DiscussCapsuleAction: (props: Record<string, unknown>) => {
    discussCapsuleActionMock(props);
    return <div data-testid="discuss-capsule-action" />;
  },
}));

import { AgentSessionDiscussActionCapsule } from "./AgentSessionDiscussActionCapsule";

describe("AgentSessionDiscussActionCapsule", () => {
  it("binds Discuss to the current Agent Session and shared launch scope", () => {
    render(
      <AgentSessionDiscussActionCapsule
        organizationId="org-1"
        projectId="project-1"
        agentSession={{ id: "session-1", title: "Coding session" }}
      />,
    );

    expect(discussCapsuleActionMock).toHaveBeenCalledWith({
      entityId: "session-1",
      entityType: TargetEntityType.AgentSession,
      entityTitle: "Coding session",
      organizationId: "org-1",
      projectId: "project-1",
    });
  });
});
