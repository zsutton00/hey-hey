import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ConversationStatus, InitiationType, WorkflowName, type ConversationResponseDto } from "../../../api";
import { ConversationHistoryList } from "./ConversationHistoryList";

const conversation: ConversationResponseDto = {
  id: "conversation-1", projectId: "project-1", organizationId: "org-1",
  createdBy: null, initiatedBy: InitiationType.User,
  status: ConversationStatus.Started, title: "Existing discussion", version: 1,
  workflowName: WorkflowName.AgentEntityConversation,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};

describe("ConversationHistoryList navigation", () => {
  it("exposes an ownership resolver href that also works when opened in a new tab", () => {
    render(<MemoryRouter>
      <ConversationHistoryList conversations={[conversation]} activeConversationId="another-conversation"
        onConversationSelect={vi.fn()} projectId="project-1" useWebLinks />
    </MemoryRouter>);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/projects/project-1/resolve-agent-session/conversation-1");
  });
});
