import { describe, expect, it, vi } from "vitest";
import { MessageStatus, MessageType } from "@hey-hey/ui-common/api";
import type { ConversationResponseDto } from "@hey-hey/ui-common/api";
import {
  calculateVersionDifference,
  createConversationReference,
  createOptimisticMessageState,
  createVersionAwareUserMessage,
  shouldShowVersionConflictDialog,
  updateUserMessageVersion,
  validateConversationForVersioning,
} from "../conversationVersionHelpers";
import type {
  VersionConflictError,
  VersionedConversationResponseDto,
} from "../../types/conversation";

const versionedConversation = {
  id: "conv-123",
  workflowId: "workflow-1",
  projectId: "project-1",
  version: 5,
  messages: [],
  updatedAt: "2026-09-08T12:00:00.000Z",
} as VersionedConversationResponseDto;

describe("conversationVersionHelpers", () => {
  it("creates the current API user-message shape with conversation version", () => {
    expect(
      createVersionAwareUserMessage(
        { message: "Test message" },
        "parent-1",
        versionedConversation,
        "project-1",
      ),
    ).toEqual({
      workflowId: "workflow-1",
      projectId: "project-1",
      data: { message: "Test message" },
      type: MessageType.User,
      conversationId: "conv-123",
      status: MessageStatus.Completed,
      parentMessageId: "parent-1",
      expectedConversationVersion: 5,
    });
  });

  it("omits the version for a non-versioned conversation", () => {
    const conversation = {
      ...versionedConversation,
      version: undefined,
    } as unknown as ConversationResponseDto;
    const message = createVersionAwareUserMessage({}, "parent-1", conversation, "project-1");

    expect(message).not.toHaveProperty("expectedConversationVersion");
    expect(message.data).toEqual({});
  });

  it("preserves version zero", () => {
    const message = createVersionAwareUserMessage(
      {},
      "",
      { ...versionedConversation, version: 0 },
      "project-1",
    );
    expect(message.expectedConversationVersion).toBe(0);
  });

  it("creates optimistic state with and without a version", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(123);
    expect(
      createOptimisticMessageState("parent", { message: "hello" }, versionedConversation),
    ).toEqual({
      parentMessageId: "parent",
      formData: { message: "hello" },
      status: "sending",
      timestamp: 123,
      expectedVersion: 5,
    });

    const legacy = { ...versionedConversation, version: undefined } as unknown as ConversationResponseDto;
    expect(createOptimisticMessageState("parent", {}, legacy).expectedVersion).toBeUndefined();
  });

  it("decides when version conflicts require a dialog", () => {
    const error = { currentVersion: 6, expectedVersion: 5 } as VersionConflictError;
    expect(shouldShowVersionConflictDialog(error, 2, 2)).toBe(true);
    expect(shouldShowVersionConflictDialog(error, 0, 2)).toBe(false);
    expect(shouldShowVersionConflictDialog({ ...error, currentVersion: 10 }, 0, 2)).toBe(true);
  });

  it("calculates non-negative version differences", () => {
    expect(calculateVersionDifference(6, 5)).toEqual({ difference: 1, description: "single" });
    expect(calculateVersionDifference(9, 5)).toEqual({ difference: 4, description: "multiple" });
    expect(calculateVersionDifference(4, 5)).toEqual({ difference: 0, description: "none" });
  });

  it("updates the expected conversation version immutably", () => {
    const original = createVersionAwareUserMessage({}, "parent", versionedConversation, "project-1");
    const updated = updateUserMessageVersion(original, 8);
    expect(updated.expectedConversationVersion).toBe(8);
    expect(original.expectedConversationVersion).toBe(5);
  });

  it("validates and references conversations", () => {
    expect(validateConversationForVersioning(versionedConversation)).toEqual({
      isValid: true,
      hasVersion: true,
      missingFields: [],
    });
    expect(createConversationReference(versionedConversation)).toEqual({
      id: "conv-123",
      version: 5,
      lastModified: new Date("2026-09-08T12:00:00.000Z"),
    });
  });
});
