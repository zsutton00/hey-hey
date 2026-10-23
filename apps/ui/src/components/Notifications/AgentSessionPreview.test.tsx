import React from "react";
import { describe, expect, it } from "vitest";
import { AgentSessionContent } from "../../pages/AgentSession/AgentSessionContent";
import { AgentSessionPreview } from "./AgentSessionPreview";

describe("AgentSessionPreview", () => {
  it("mounts the canonical agent-session composition with Preview isolation", () => {
    const element = AgentSessionPreview({
      organizationId: "org-1",
      projectId: "project-1",
      sessionId: "session-1",
    }) as React.ReactElement<Record<string, unknown>>;

    expect(element.type).toBe(AgentSessionContent);
    expect(element.props).toMatchObject({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      preview: true,
    });
  });
});
