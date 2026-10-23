import { describe, expect, it } from "vitest";
import {
  platformClient,
  projectsClient,
  unifiedApiClient,
} from "../clients/serviceClients";
import { MessageReadMode } from "../api";
import { fetchEntityStars } from "../data/collections/entityStars";
import { fetchAllWorkItemReferences } from "../data/collections/workItemReferences";

describe("shared fixture background reads", () => {
  it("serves empty message history and disconnected CLI presence after handlers reset", async () => {
    globalThis.mswServer.resetHandlers();
    const scope = {
      organizationId: "another-organization",
      projectId: "another-project",
      conversationId: "another-conversation",
    };
    const history = await platformClient.getMessages({
      ...scope,
      mode: MessageReadMode.ReverseHistory,
    });
    expect(history.data.data).toEqual({ messages: [] });
    const messages = await platformClient.getMessages(scope);
    expect(messages.data.data).toEqual([]);
    const presence = await unifiedApiClient.getConversationCliStatus(scope);
    expect(presence.data.data).toEqual({
      connected: false,
      selectedMachineId: null,
      authorizationProtocolVersion: null,
      executionReadiness: "NO_MACHINE_SELECTED",
    });
  });

  it("serves shared reads for arbitrary organization and project IDs", async () => {
    globalThis.mswServer.resetHandlers();
    await expect(fetchEntityStars("another-organization")).resolves.toEqual([]);
    await expect(
      fetchAllWorkItemReferences({
        organizationId: "another-organization",
        projectId: "another-project",
        workItemType: "FEATURE",
      })
    ).resolves.toEqual([]);
    const response = await projectsClient.getQueuedConversationInputs({
      organizationId: "another-organization",
      projectId: "another-project",
      conversationId: "another-conversation",
    });
    expect(response.data.data).toEqual([]);
  });

  it("serves setup feature references after runtime handlers are reset", async () => {
    globalThis.mswServer.resetHandlers();
    await expect(
      fetchAllWorkItemReferences({
        organizationId: "org-1",
        projectId: "proj-1",
        workItemType: "FEATURE",
      })
    ).resolves.toEqual([]);
  });

  it("serves stars after runtime handlers are reset", async () => {
    globalThis.mswServer.resetHandlers();
    await expect(fetchEntityStars("org-1")).resolves.toEqual([]);
  });

  it.each([
    "conv-1",
    "conv-new",
    "existing-conversation",
    "goal-pm-conversation",
    "conv-existing",
  ])(
    "serves queued inputs for %s after runtime handlers are reset",
    async (conversationId) => {
      globalThis.mswServer.resetHandlers();
      const response = await projectsClient.getQueuedConversationInputs({
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId,
      });
      expect(response.data.success).toBe(true);
      expect(response.data.data).toEqual([]);
    }
  );
});
