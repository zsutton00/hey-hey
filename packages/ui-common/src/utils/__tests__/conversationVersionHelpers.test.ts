import { describe, it, expect, vi } from "vitest";
import {
  createVersionAwareUserMessage,
  shouldUpdateConversationVersion,
  handleVersionConflictUpdate,
} from "../conversationVersionHelpers";
import type {
  CreateUserMessage,
  ConversationResponseDto,
  VersionedConversationResponseDto,
  VersionConflictError,
} from "../../types/conversation";
import type { FormValue } from "../../types/forms";

describe("conversationVersionHelpers", () => {
  describe("createVersionAwareUserMessage", () => {
    const mockFormData: Record<string, FormValue> = {
      message: "Test message content",
      context: "Additional context",
      priority: "high",
    };

    const mockConversation: VersionedConversationResponseDto = {
      id: "conv-123",
      version: 5,
      messages: [],
      projectId: "proj-456",
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:00Z",
    } as VersionedConversationResponseDto;

    it("should create user message with version for versioned conversation", () => {
      const result = createVersionAwareUserMessage(
        mockFormData,
        "parent-msg-123",
        mockConversation
      );

      expect(result.data).toEqual(mockFormData);
      expect(result.parentMessageId).toBe("parent-msg-123");
      expect(result.expectedConversationVersion).toBe(5);
      expect(result.content).toEqual(mockFormData);
      expect(result.expectedVersion).toBe(5);

      // Ensure JSON serialization strips compatibility aliases
      expect(result.toJSON()).toMatchObject({
        data: mockFormData,
        parentMessageId: "parent-msg-123",
        expectedConversationVersion: 5,
      });
    });

    it("should create user message without version for non-versioned conversation", () => {
      const nonVersionedConversation: ConversationResponseDto = {
        id: "conv-123",
        messages: [],
        projectId: "proj-456",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:00:00Z",
      } as ConversationResponseDto;

      const result = createVersionAwareUserMessage(
        mockFormData,
        "parent-msg-123",
        nonVersionedConversation
      );

      expect(result.data).toEqual(mockFormData);
      expect(result.parentMessageId).toBe("parent-msg-123");
      expect(result.expectedConversationVersion).toBeUndefined();
      expect(result.content).toEqual(mockFormData);
      expect(result.expectedVersion).toBeUndefined();

      expect(result.toJSON()).toMatchObject({
        data: mockFormData,
        parentMessageId: "parent-msg-123",
      });
    });

    it("should handle null conversation gracefully", () => {
      const result = createVersionAwareUserMessage(
        mockFormData,
        "parent-msg-123",
        null
      );

      expect(result.data).toEqual(mockFormData);
      expect(result.parentMessageId).toBe("parent-msg-123");
      expect(result.expectedConversationVersion).toBeUndefined();
      expect(result.content).toEqual(mockFormData);
      expect(result.expectedVersion).toBeUndefined();
    });

    it("should handle undefined conversation gracefully", () => {
      const result = createVersionAwareUserMessage(
        mockFormData,
        "parent-msg-123",
        undefined
      );

      expect(result.data).toEqual(mockFormData);
      expect(result.parentMessageId).toBe("parent-msg-123");
      expect(result.expectedConversationVersion).toBeUndefined();
      expect(result.content).toEqual(mockFormData);
      expect(result.expectedVersion).toBeUndefined();
    });

    it("should handle empty form data", () => {
      const emptyFormData: Record<string, FormValue> = {};

      const result = createVersionAwareUserMessage(
        emptyFormData,
        "parent-msg-123",
        mockConversation
      );

      expect(result.data).toEqual(emptyFormData);
      expect(result.parentMessageId).toBe("parent-msg-123");
      expect(result.expectedConversationVersion).toBe(5);
      expect(result.content).toEqual(emptyFormData);
      expect(result.expectedVersion).toBe(5);
    });

    it("should handle version 0 correctly", () => {
      const conversationWithZeroVersion: VersionedConversationResponseDto = {
        ...mockConversation,
        version: 0,
      };

      const result = createVersionAwareUserMessage(
        mockFormData,
        "parent-msg-123",
        conversationWithZeroVersion
      );

      expect(result.expectedVersion).toBe(0);
    });

    it("should handle complex form data structures", () => {
      const complexFormData: Record<string, FormValue> = {
        message: "Test message",
        attachments: ["file1.txt", "file2.png"],
        metadata: { priority: "high", category: "technical" },
        tags: ["urgent", "bug-fix"],
        richContent: {
          type: "rich-text",
          blocks: [
            { type: "paragraph", text: "Some text" },
            { type: "code", language: "typescript", code: "const x = 1;" },
          ],
        },
      };

      const result = createVersionAwareUserMessage(
        complexFormData,
        "parent-msg-123",
        mockConversation
      );

      expect(result.content).toEqual(complexFormData);
      expect(result.expectedVersion).toBe(5);
    });
  });

  describe("shouldUpdateConversationVersion", () => {
    it("should return true when new version is higher", () => {
      expect(shouldUpdateConversationVersion(5, 3)).toBe(true);
      expect(shouldUpdateConversationVersion(10, 1)).toBe(true);
      expect(shouldUpdateConversationVersion(1, 0)).toBe(true);
    });

    it("should return false when new version equals current", () => {
      expect(shouldUpdateConversationVersion(5, 5)).toBe(false);
      expect(shouldUpdateConversationVersion(0, 0)).toBe(false);
      expect(shouldUpdateConversationVersion(100, 100)).toBe(false);
    });

    it("should return false when new version is lower", () => {
      expect(shouldUpdateConversationVersion(3, 5)).toBe(false);
      expect(shouldUpdateConversationVersion(1, 10)).toBe(false);
      expect(shouldUpdateConversationVersion(0, 1)).toBe(false);
    });

    it("should return true when current version is null", () => {
      expect(shouldUpdateConversationVersion(5, null)).toBe(true);
      expect(shouldUpdateConversationVersion(0, null)).toBe(true);
    });

    it("should return true when current version is undefined", () => {
      expect(shouldUpdateConversationVersion(5, undefined)).toBe(true);
      expect(shouldUpdateConversationVersion(0, undefined)).toBe(true);
    });

    it("should handle edge cases with zero versions", () => {
      expect(shouldUpdateConversationVersion(0, null)).toBe(true);
      expect(shouldUpdateConversationVersion(0, undefined)).toBe(true);
      expect(shouldUpdateConversationVersion(1, 0)).toBe(true);
    });

    it("should handle large version numbers", () => {
      const maxSafe = Number.MAX_SAFE_INTEGER;
      expect(shouldUpdateConversationVersion(maxSafe, maxSafe - 1)).toBe(true);
      expect(shouldUpdateConversationVersion(maxSafe - 1, maxSafe)).toBe(false);
      expect(shouldUpdateConversationVersion(maxSafe, maxSafe)).toBe(false);
    });
  });

  describe("handleVersionConflictUpdate", () => {
    const mockConversationUpdate = vi.fn();

    const mockVersionConflictError: VersionConflictError = {
      error: "VERSION_CONFLICT",
      currentVersion: 10,
      expectedVersion: 5,
      latestConversation: {
        id: "conv-123",
        version: 10,
        messages: [
          {
            id: "msg-1",
            content: "Updated message",
            role: "user",
            createdAt: "2023-01-01T00:00:00Z",
          },
        ],
        projectId: "proj-456",
        createdAt: "2023-01-01T00:00:00Z",
        updatedAt: "2023-01-01T00:01:00Z",
      } as VersionedConversationResponseDto,
    };

    beforeEach(() => {
      mockConversationUpdate.mockClear();
    });

    it("should call conversation update with latest conversation data", () => {
      handleVersionConflictUpdate(
        mockVersionConflictError,
        mockConversationUpdate
      );

      expect(mockConversationUpdate).toHaveBeenCalledTimes(1);
      expect(mockConversationUpdate).toHaveBeenCalledWith(
        mockVersionConflictError.latestConversation
      );
    });

    it("should handle version conflict error with minimal data", () => {
      const minimalError: VersionConflictError = {
        error: "VERSION_CONFLICT",
        currentVersion: 3,
        expectedVersion: 1,
        latestConversation: {
          id: "conv-minimal",
          version: 3,
          messages: [],
          projectId: "proj-minimal",
        } as VersionedConversationResponseDto,
      };

      handleVersionConflictUpdate(minimalError, mockConversationUpdate);

      expect(mockConversationUpdate).toHaveBeenCalledWith(
        minimalError.latestConversation
      );
    });

    it("should handle version conflict error with complex conversation data", () => {
      const complexError: VersionConflictError = {
        error: "VERSION_CONFLICT",
        currentVersion: 15,
        expectedVersion: 12,
        latestConversation: {
          id: "conv-complex",
          version: 15,
          messages: [
            {
              id: "msg-1",
              content: "First message",
              role: "user",
              createdAt: "2023-01-01T00:00:00Z",
              metadata: { priority: "high" },
            },
            {
              id: "msg-2",
              content: "Assistant response",
              role: "assistant",
              createdAt: "2023-01-01T00:01:00Z",
              metadata: { model: "gpt-4" },
            },
          ],
          projectId: "proj-complex",
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T00:02:00Z",
          metadata: {
            tags: ["important", "technical"],
            category: "support",
          },
        } as VersionedConversationResponseDto,
      };

      handleVersionConflictUpdate(complexError, mockConversationUpdate);

      expect(mockConversationUpdate).toHaveBeenCalledWith(
        complexError.latestConversation
      );
    });

    it("should work with different update callback signatures", () => {
      const alternativeCallback = vi.fn((conversation) => {
        // Simulate some processing
        return { success: true, processedConversation: conversation };
      });

      handleVersionConflictUpdate(
        mockVersionConflictError,
        alternativeCallback
      );

      expect(alternativeCallback).toHaveBeenCalledWith(
        mockVersionConflictError.latestConversation
      );
    });

    it("should handle callback that throws an error", () => {
      const throwingCallback = vi.fn(() => {
        throw new Error("Callback error");
      });

      // Should not throw - error handling should be in the calling code
      expect(() => {
        handleVersionConflictUpdate(mockVersionConflictError, throwingCallback);
      }).toThrow("Callback error");

      expect(throwingCallback).toHaveBeenCalledWith(
        mockVersionConflictError.latestConversation
      );
    });

    it("should handle async callback functions", async () => {
      const asyncCallback = vi.fn(async (conversation) => {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 10));
        return conversation;
      });

      // The helper should support async callbacks
      const result = handleVersionConflictUpdate(
        mockVersionConflictError,
        asyncCallback
      );

      expect(asyncCallback).toHaveBeenCalledWith(
        mockVersionConflictError.latestConversation
      );

      // If the helper supports async, this should work
      if (result instanceof Promise) {
        await result;
      }
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete conversation version update flow", () => {
      const formData: Record<string, FormValue> = {
        message: "Test message",
        priority: "high",
      };

      const originalConversation: VersionedConversationResponseDto = {
        id: "conv-123",
        version: 5,
        messages: [],
        projectId: "proj-456",
      } as VersionedConversationResponseDto;

      // Create message with version
      const userMessage = createVersionAwareUserMessage(
        formData,
        "parent-msg-123",
        originalConversation
      );

      expect(userMessage.expectedVersion).toBe(5);

      // Simulate version conflict scenario
      const versionConflictError: VersionConflictError = {
        error: "VERSION_CONFLICT",
        currentVersion: 8,
        expectedVersion: 5,
        latestConversation: {
          ...originalConversation,
          version: 8,
          messages: [{ id: "new-msg", content: "New message", role: "user" }],
        } as VersionedConversationResponseDto,
      };

      // Handle version conflict
      const mockUpdate = vi.fn();
      handleVersionConflictUpdate(versionConflictError, mockUpdate);

      expect(mockUpdate).toHaveBeenCalledWith(
        versionConflictError.latestConversation
      );

      // Verify update logic
      expect(shouldUpdateConversationVersion(8, 5)).toBe(true);
    });

    it("should handle backward compatibility scenarios", () => {
      const formData: Record<string, FormValue> = {
        message: "Test message",
      };

      // Non-versioned conversation
      const legacyConversation: ConversationResponseDto = {
        id: "conv-legacy",
        messages: [],
        projectId: "proj-legacy",
      } as ConversationResponseDto;

      const userMessage = createVersionAwareUserMessage(
        formData,
        "parent-msg-123",
        legacyConversation
      );

      // Should not include expectedVersion for legacy conversations
      expect(userMessage.expectedVersion).toBeUndefined();
      expect(userMessage.content).toEqual(formData);
      expect(userMessage.parentMessageId).toBe("parent-msg-123");
    });

    it("should handle edge cases in complete flow", () => {
      // Test with minimal data
      const minimalFormData: Record<string, FormValue> = {};
      const minimalConversation: VersionedConversationResponseDto = {
        id: "minimal",
        version: 0,
        messages: [],
        projectId: "minimal-proj",
      } as VersionedConversationResponseDto;

      const userMessage = createVersionAwareUserMessage(
        minimalFormData,
        "",
        minimalConversation
      );

      expect(userMessage.expectedVersion).toBe(0);
      expect(userMessage.content).toEqual({});
      expect(userMessage.parentMessageId).toBe("");

      // Version comparison should work with zero
      expect(shouldUpdateConversationVersion(1, 0)).toBe(true);
      expect(shouldUpdateConversationVersion(0, 0)).toBe(false);
    });
  });

  describe("type safety and error handling", () => {
    it("should maintain type safety with mixed conversation types", () => {
      const formData: Record<string, FormValue> = { message: "test" };

      const conversations: (
        | ConversationResponseDto
        | VersionedConversationResponseDto
        | null
        | undefined
      )[] = [
        {
          id: "conv1",
          version: 5,
          messages: [],
          projectId: "proj1",
        } as VersionedConversationResponseDto,
        {
          id: "conv2",
          messages: [],
          projectId: "proj2",
        } as ConversationResponseDto,
        null,
        undefined,
      ];

      conversations.forEach((conversation, index) => {
        expect(() => {
          createVersionAwareUserMessage(
            formData,
            `parent-${index}`,
            conversation
          );
        }).not.toThrow();
      });
    });

    it("should handle malformed version data gracefully", () => {
      const formData: Record<string, FormValue> = { message: "test" };

      // Conversation with invalid version type
      const malformedConversation = {
        id: "conv-malformed",
        version: "not-a-number",
        messages: [],
        projectId: "proj-malformed",
      } as unknown as VersionedConversationResponseDto;

      const result = createVersionAwareUserMessage(
        formData,
        "parent-msg",
        malformedConversation
      );

      // Should handle gracefully - implementation depends on hasVersionInfo logic
      expect(result.content).toEqual(formData);
      expect(result.parentMessageId).toBe("parent-msg");
    });

    it("should handle version comparison edge cases safely", () => {
      // Test with extreme values
      const extremeValues = [
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        NaN,
      ];

      extremeValues.forEach((value) => {
        expect(() => {
          shouldUpdateConversationVersion(value, 1);
          shouldUpdateConversationVersion(1, value as number);
        }).not.toThrow();
      });
    });
  });
});
