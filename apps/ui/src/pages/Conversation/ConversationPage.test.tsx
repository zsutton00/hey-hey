import React from "react";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ConversationPage } from "./ConversationPage";

const canonicalBoundaryMock = vi.fn();

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    conversation: ({ projectId, conversationId }: Record<string, string>) =>
      `/projects/${projectId}/conversations/${conversationId}`,
  },
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  CanonicalPageBoundary: ({
    children,
    composition,
  }: {
    children: React.ReactNode;
    composition: unknown;
  }) => {
    canonicalBoundaryMock(composition);
    return children;
  },
  TrackingProvider: ({ children }: { children: React.ReactNode }) => children,
  createCanonicalPageDescriptor: (
    entityType: string,
    entityId: string,
    lineage: unknown,
    presentation?: unknown,
  ) => ({ entityType, entityId, lineage, presentation }),
}));

vi.mock("../../components/Conversation/ActiveConversation", () => ({
  ActiveConversation: ({
    onPresentationLoaded,
  }: {
    onPresentationLoaded?: (label: string) => void;
  }) => {
    React.useEffect(() => {
      onPresentationLoaded?.("Planning discussion");
    }, [onPresentationLoaded]);
    return <div>Conversation</div>;
  },
}));

describe("ConversationPage", () => {
  it("publishes the loaded conversation title in canonical presentation", async () => {
    render(
      <MemoryRouter
        initialEntries={["/projects/project-1/conversations/conversation-1"]}
      >
        <Routes>
          <Route
            path="/projects/:projectId/conversations/:conversationId"
            element={<ConversationPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(canonicalBoundaryMock).toHaveBeenLastCalledWith({
        kind: "canonical",
        descriptor: {
          entityType: "conversation",
          entityId: "conversation-1",
          lineage: null,
          presentation: {
            kind: "conversation",
            label: "Planning discussion",
          },
        },
      });
    });
  });
});
