import { describe, it, expect } from "vitest";
import {
  isVersionNewer,
  isVersionConflictError,
  hasVersionInfo,
  getCurrentVersion,
} from "../versionUtils";
import type {
  VersionConflictError,
  VersionedConversationResponseDto,
} from "../../types/conversation";
import type { ConversationResponseDto } from "../../api";

describe("versionUtils", () => {
  describe("isVersionNewer", () => {
    it("should return true when new version is greater than current", () => {
      expect(isVersionNewer(5, 3)).toBe(true);
      expect(isVersionNewer(10, 9)).toBe(true);
      expect(isVersionNewer(100, 1)).toBe(true);
    });

    it("should return false when new version equals current", () => {
      expect(isVersionNewer(5, 5)).toBe(false);
      expect(isVersionNewer(0, 0)).toBe(false);
      expect(isVersionNewer(1000, 1000)).toBe(false);
    });

    it("should return false when new version is less than current", () => {
      expect(isVersionNewer(3, 5)).toBe(false);
      expect(isVersionNewer(9, 10)).toBe(false);
      expect(isVersionNewer(1, 100)).toBe(false);
    });

    it("should handle edge cases with zero versions", () => {
      expect(isVersionNewer(1, 0)).toBe(true);
      expect(isVersionNewer(0, 1)).toBe(false);
      expect(isVersionNewer(0, 0)).toBe(false);
    });

    it("should handle large version numbers", () => {
      expect(
        isVersionNewer(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1)
      ).toBe(true);
      expect(
        isVersionNewer(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER)
      ).toBe(false);
    });
  });

  describe("isVersionConflictError", () => {
    it("should return true for valid version conflict error", () => {
      const error: VersionConflictError = {
        error: "VERSION_CONFLICT",
        currentVersion: 5,
        expectedVersion: 3,
        latestConversation: {
          id: "conv-123",
          version: 5,
          messages: [],
          projectId: "proj-456",
        } as VersionedConversationResponseDto,
      };

      expect(isVersionConflictError(error)).toBe(true);
    });

    it("should return false for null or undefined", () => {
      expect(isVersionConflictError(null)).toBe(false);
      expect(isVersionConflictError(undefined)).toBe(false);
    });

    it("should return false for non-object values", () => {
      expect(isVersionConflictError("string")).toBe(false);
      expect(isVersionConflictError(123)).toBe(false);
      expect(isVersionConflictError(true)).toBe(false);
    });

    it("should return false for objects without error property", () => {
      expect(isVersionConflictError({})).toBe(false);
      expect(isVersionConflictError({ currentVersion: 5 })).toBe(false);
    });

    it("should return false for objects with wrong error type", () => {
      expect(isVersionConflictError({ error: "OTHER_ERROR" })).toBe(false);
      expect(isVersionConflictError({ error: "NETWORK_ERROR" })).toBe(false);
      expect(isVersionConflictError({ error: 123 })).toBe(false);
    });

    it("should return false for Error objects", () => {
      const standardError = new Error("Some error");
      expect(isVersionConflictError(standardError)).toBe(false);
    });

    it("should return false for partial version conflict objects", () => {
      expect(
        isVersionConflictError({
          error: "VERSION_CONFLICT",
          // Missing other required properties
        })
      ).toBe(false);
    });
  });

  describe("hasVersionInfo", () => {
    it("should return true for objects with version property", () => {
      const versionedData: VersionedConversationResponseDto = {
        id: "conv-123",
        version: 5,
        messages: [],
        projectId: "proj-456",
      } as VersionedConversationResponseDto;

      expect(hasVersionInfo(versionedData)).toBe(true);
    });

    it("should return false for objects without version property", () => {
      const nonVersionedData: ConversationResponseDto = {
        id: "conv-123",
        messages: [],
        projectId: "proj-456",
      } as ConversationResponseDto;

      expect(hasVersionInfo(nonVersionedData)).toBe(false);
    });

    it("should return false for null or undefined", () => {
      expect(hasVersionInfo(null)).toBe(false);
      expect(hasVersionInfo(undefined)).toBe(false);
    });

    it("should return false for non-object values", () => {
      expect(hasVersionInfo("string")).toBe(false);
      expect(hasVersionInfo(123)).toBe(false);
      expect(hasVersionInfo(true)).toBe(false);
    });

    it("should return false for objects with non-number version", () => {
      expect(hasVersionInfo({ version: "string" })).toBe(false);
      expect(hasVersionInfo({ version: null })).toBe(false);
      expect(hasVersionInfo({ version: undefined })).toBe(false);
      expect(hasVersionInfo({ version: {} })).toBe(false);
    });

    it("should return true for objects with version 0", () => {
      expect(hasVersionInfo({ version: 0 })).toBe(true);
    });

    it("should return true for objects with negative version numbers", () => {
      expect(hasVersionInfo({ version: -1 })).toBe(true);
    });
  });

  describe("getCurrentVersion", () => {
    it("should return version for versioned conversation data", () => {
      const versionedData: VersionedConversationResponseDto = {
        id: "conv-123",
        version: 42,
        messages: [],
        projectId: "proj-456",
      } as VersionedConversationResponseDto;

      expect(getCurrentVersion(versionedData)).toBe(42);
    });

    it("should return undefined for non-versioned conversation data", () => {
      const nonVersionedData: ConversationResponseDto = {
        id: "conv-123",
        messages: [],
        projectId: "proj-456",
      } as ConversationResponseDto;

      expect(getCurrentVersion(nonVersionedData)).toBeUndefined();
    });

    it("should return undefined for null or undefined input", () => {
      expect(getCurrentVersion(null)).toBeUndefined();
      expect(getCurrentVersion(undefined)).toBeUndefined();
    });

    it("should return 0 for version 0", () => {
      const data = { version: 0 } as VersionedConversationResponseDto;
      expect(getCurrentVersion(data)).toBe(0);
    });

    it("should return negative versions", () => {
      const data = { version: -5 } as VersionedConversationResponseDto;
      expect(getCurrentVersion(data)).toBe(-5);
    });

    it("should return undefined for objects with non-number version", () => {
      expect(
        getCurrentVersion({
          version: "string",
        } as unknown as ConversationResponseDto)
      ).toBeUndefined();
      expect(
        getCurrentVersion({
          version: null,
        } as unknown as ConversationResponseDto)
      ).toBeUndefined();
      expect(
        getCurrentVersion({ version: {} } as unknown as ConversationResponseDto)
      ).toBeUndefined();
    });
  });

  describe("type safety and edge cases", () => {
    it("should handle concurrent version operations", () => {
      // Test multiple rapid version comparisons
      const results = [];
      for (let i = 0; i < 100; i++) {
        results.push(isVersionNewer(i + 1, i));
      }
      expect(results.every((result) => result === true)).toBe(true);
    });

    it("should maintain type safety with mixed data types", () => {
      const mixedData = [
        { version: 1 },
        { notVersion: 1 },
        null,
        undefined,
        "string",
        123,
        { version: "not-a-number" },
      ];

      mixedData.forEach((data) => {
        // Should not throw errors regardless of input type
        expect(() => hasVersionInfo(data)).not.toThrow();
        expect(() =>
          getCurrentVersion(data as ConversationResponseDto)
        ).not.toThrow();
      });
    });

    it("should handle version comparison consistency", () => {
      // Test mathematical properties
      const a = 5,
        b = 10,
        c = 15;

      // Transitivity: if a < b and b < c, then a < c
      expect(isVersionNewer(b, a)).toBe(true);
      expect(isVersionNewer(c, b)).toBe(true);
      expect(isVersionNewer(c, a)).toBe(true);

      // Anti-symmetry: if a < b, then b > a
      expect(isVersionNewer(b, a)).toBe(true);
      expect(isVersionNewer(a, b)).toBe(false);

      // Reflexivity: a == a
      expect(isVersionNewer(a, a)).toBe(false);
    });
  });
});
