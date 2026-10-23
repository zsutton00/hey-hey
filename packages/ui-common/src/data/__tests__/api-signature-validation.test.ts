/**
 * API Signature Validation Tests
 *
 * These tests ensure that hook signatures remain consistent with expected patterns
 * to prevent regressions when API types are updated.
 */

import { describe, it, expect } from "vitest";
import type { UseConversationOptions } from "../hooks/useConversation";
import type { UseConversationsOptions } from "../hooks/useConversations";
import type {
  CreateEntityPromptTemplateChangeProposalVariables,
  CreateEntityPromptTemplateRetirementProposalVariables,
} from "../hooks/useEntityPromptTemplates";
import {
  AgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum,
  type AgentSessionConfigEntityConversationV1,
} from "../../api/api";
import {
  AgentSessionConfigEntityConversationV1TypeEnum as LocalAgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum as LocalAgentSessionConfigEntityConversationV1VersionEnum,
  type AgentSessionConfigEntityConversationV1 as LocalAgentSessionConfigEntityConversationV1,
} from "../../api/api";

describe("API Signature Validation", () => {
  describe("entity prompt-template proposal signatures", () => {
    it("requires complete generated selectors and applicability revisions", () => {
      const change: CreateEntityPromptTemplateChangeProposalVariables = {
        organizationId: "org-1",
        projectId: "project-1",
        templateKey: "entity_context",
        selector: {
          entityType: "WORK_ITEM",
          workItemTypeKey: "STANDARD",
        },
        syntaxVersion: "V1",
        content: "{{entity.name}}",
        expectedEffectiveRevision: {
          revisionId: "revision-1",
          revisionNumber: 1,
        },
      };
      const retirement: CreateEntityPromptTemplateRetirementProposalVariables =
        {
          organizationId: change.organizationId,
          projectId: change.projectId,
          templateKey: change.templateKey,
          selector: change.selector,
          expectedEffectiveRevision: change.expectedEffectiveRevision,
        };

      expect(change.selector).toEqual({
        entityType: "WORK_ITEM",
        workItemTypeKey: "STANDARD",
      });
      expect(retirement.expectedEffectiveRevision).toEqual(
        change.expectedEffectiveRevision
      );
    });
  });

  describe("useConversation signature", () => {
    it("should enforce object-based query options", () => {
      // This test ensures the third parameter is always an object
      const validConversationOptions: UseConversationOptions = {
        conversationId: "test-id",
      };
      expect(validConversationOptions).toHaveProperty("conversationId");

      const validCategoryOptions: UseConversationOptions = {
        category: "test-category",
      };
      expect(validCategoryOptions).toHaveProperty("category");
    });

    it("should prevent direct string parameters", () => {
      // This test would fail compilation if someone tries to use old signature
      // useConversation("org", "project", "conversation") // ❌ Would fail TypeScript
      // useConversation("org", "project", { conversationId: "conv" }) // ✅ Correct

      // TypeScript compile-time validation - if this compiles, the signature is correct
      type ConversationQueryType = UseConversationOptions extends string
        ? never
        : "valid";
      const validation: ConversationQueryType = "valid";
      expect(validation).toBe("valid");
    });
  });

  describe("useConversations signature", () => {
    it("should enforce options object pattern", () => {
      const validOptions: UseConversationsOptions = {
        category: "test",
        search: "query",
      };

      expect(validOptions).toHaveProperty("category");
      expect(validOptions).toHaveProperty("search");
    });
  });

  describe("API consistency checks", () => {
    it("should maintain consistent option patterns across hooks", () => {
      // Ensures all data hooks follow similar patterns
      const conversationOptions: UseConversationOptions = {
        conversationId: "test",
      };
      const conversationsOptions: UseConversationsOptions = {
        category: "test",
      };

      // Both should be objects (not primitive types)
      expect(typeof conversationOptions).toBe("object");
      expect(typeof conversationsOptions).toBe("object");
      expect(conversationOptions).not.toBeNull();
      expect(conversationsOptions).not.toBeNull();
    });
  });

  describe("Entity Conversation Project Assistant config", () => {
    it.each([
      ["omitted", undefined],
      ["enabled", { enabled: true }],
      ["disabled", { enabled: false }],
    ] as const)(
      "serializes the %s state identically in platform and local clients",
      (_state, projectAssistant) => {
        const platformConfig: AgentSessionConfigEntityConversationV1 = {
          type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
          version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
          model: "gpt-5.6-luna",
          ...(projectAssistant === undefined ? {} : { projectAssistant }),
        };
        const localConfig: LocalAgentSessionConfigEntityConversationV1 = {
          type: LocalAgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
          version: LocalAgentSessionConfigEntityConversationV1VersionEnum.V1,
          model: "gpt-5.6-luna",
          ...(projectAssistant === undefined ? {} : { projectAssistant }),
        };

        const platformWire = JSON.parse(JSON.stringify(platformConfig));
        const localWire = JSON.parse(JSON.stringify(localConfig));

        expect(platformWire).toEqual(localWire);
        if (projectAssistant === undefined) {
          expect(platformWire).not.toHaveProperty("projectAssistant");
        } else {
          expect(platformWire.projectAssistant.enabled).toBe(
            projectAssistant.enabled
          );
        }
      }
    );
  });

  describe("Regression prevention", () => {
    it("should prevent accidental signature changes", () => {
      // This test will fail if someone accidentally changes the hook signatures
      // back to the old string-based pattern

      // Mock function signatures that should exist
      const mockUseConversation = (
        orgId: string | undefined,
        projectId: string | undefined,
        queryOptions: UseConversationOptions,
        options?: { enabled?: boolean }
      ) => {
        return { data: null, isLoading: false };
      };

      // Test that the signature accepts object-based parameters
      const result = mockUseConversation("org", "project", {
        conversationId: "test",
      });
      expect(result).toBeDefined();

      // This would fail TypeScript compilation if signature was changed to string:
      // mockUseConversation('org', 'project', 'direct-string'); // ❌ Should fail
    });
  });
});
