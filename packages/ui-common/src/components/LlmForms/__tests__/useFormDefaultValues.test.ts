import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useFormDefaultValues } from "../useFormDefaultValues";
import type { UIElement } from "../../../api";
import { ExtendedUIFieldType } from "../../../api";

/**
 * Tests for useFormDefaultValues hook.
 *
 * This hook handles a critical priority decision:
 *
 * 1. System data fields (task_stub, task_list, initiative_list):
 *    - Server provides the content (stubs, tasks, initiatives)
 *    - User reviews/accepts/rejects but doesn't author the core data
 *    - initialData MUST take precedence over localStorage
 *    - If localStorage wins, stale/empty values cause "Invalid data" errors
 *
 * 2. User input fields (text, textarea, select, etc.):
 *    - User authors the content
 *    - localStorage should preserve drafts across refreshes
 *    - localStorage takes precedence over initialData
 */

const createUIElement = (
  overrides: Partial<UIElement> & { id: string; type: string }
): UIElement => ({
  label: "Test Field",
  influences: [],
  required: false,
  ...overrides,
});

describe("useFormDefaultValues", () => {
  it.each(["", "An unsent revision"])(
    "uses the submitted answer instead of a conversation draft %j",
    (draft) => {
      const { result } = renderHook(() =>
        useFormDefaultValues({
          uiElements: [createUIElement({ id: "feedback", type: "textarea" })],
          isSubmitted: true,
          initialData: { feedback: "Keep the navigation visible" },
          getPersistedValues: () => ({ feedback: draft }),
        })
      );

      expect(result.current.feedback).toBe("Keep the navigation visible");
    }
  );

  describe("system data fields (task_stub, task_list, initiative_list)", () => {
    it("should use initialData over localStorage for task_stub fields", () => {
      const uiElements = [
        createUIElement({
          id: "stub-field",
          type: ExtendedUIFieldType.TaskStub,
        }),
      ];

      const initialData = {
        "stub-field": {
          type: "TASK_STUBS",
          stubs: [{ id: "1", title: "Test Stub" }],
          response: "Here are stubs",
        },
      };

      const getPersistedValues = vi.fn().mockReturnValue({
        "stub-field": "", // Stale localStorage value
      });

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData,
          getPersistedValues,
        })
      );

      expect(result.current["stub-field"]).toEqual(initialData["stub-field"]);
    });

    it("should use initialData over localStorage for task_list fields", () => {
      const uiElements = [
        createUIElement({
          id: "task-field",
          type: ExtendedUIFieldType.TaskList,
        }),
      ];

      const initialData = {
        "task-field": {
          type: "TASKS",
          tasks: [{ title: "Task 1" }],
        },
      };

      const getPersistedValues = vi.fn().mockReturnValue({
        "task-field": "", // Stale localStorage value
      });

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData,
          getPersistedValues,
        })
      );

      expect(result.current["task-field"]).toEqual(initialData["task-field"]);
    });

    it("should use initialData over localStorage for initiative_list fields", () => {
      const uiElements = [
        createUIElement({
          id: "initiative-field",
          type: ExtendedUIFieldType.InitiativeList,
        }),
      ];

      const initialData = {
        "initiative-field": {
          type: "INITIATIVES",
          initiatives: [{ id: "1", name: "Test Initiative" }],
        },
      };

      const getPersistedValues = vi.fn().mockReturnValue({
        "initiative-field": undefined,
      });

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData,
          getPersistedValues,
        })
      );

      expect(result.current["initiative-field"]).toEqual(
        initialData["initiative-field"]
      );
    });

    it("should use initialData over localStorage for plan_document_view fields", () => {
      const uiElements = [
        createUIElement({
          id: "plan-document-field",
          type: ExtendedUIFieldType.PlanDocumentView,
        }),
      ];

      const initialData = {
        "plan-document-field": {
          entityId: "design-doc-server",
          template: "PLAN_DOCUMENT",
        },
      };

      const getPersistedValues = vi.fn().mockReturnValue({
        "plan-document-field": {
          entityId: "design-doc-stale",
        },
      });

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData,
          getPersistedValues,
        })
      );

      expect(result.current["plan-document-field"]).toEqual(
        initialData["plan-document-field"]
      );
    });

    it("should keep legacy BRAINSTORM template values for plan_document_view fields", () => {
      const uiElements = [
        createUIElement({
          id: "plan-document-field",
          type: ExtendedUIFieldType.PlanDocumentView,
        }),
      ];

      const initialData = {
        "plan-document-field": {
          entityId: "design-doc-server",
          template: "BRAINSTORM",
        },
      };

      const getPersistedValues = vi.fn().mockReturnValue({
        "plan-document-field": {
          entityId: "design-doc-stale",
          template: "PLAN_DOCUMENT",
        },
      });

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData,
          getPersistedValues,
        })
      );

      expect(result.current["plan-document-field"]).toEqual(
        initialData["plan-document-field"]
      );
    });

    it("should fall back to localStorage if initialData is missing for system fields", () => {
      const uiElements = [
        createUIElement({
          id: "stub-field",
          type: ExtendedUIFieldType.TaskStub,
        }),
      ];

      const persistedData = {
        "stub-field": { type: "TASK_STUBS", stubs: [], response: "Cached" },
      };

      const getPersistedValues = vi.fn().mockReturnValue(persistedData);

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData: undefined,
          getPersistedValues,
        })
      );

      expect(result.current["stub-field"]).toEqual(persistedData["stub-field"]);
    });
  });

  describe("user input fields", () => {
    it("should use localStorage over initialData for text fields", () => {
      const uiElements = [
        createUIElement({
          id: "text-field",
          type: ExtendedUIFieldType.TextInput,
        }),
      ];

      const initialData = {
        "text-field": "Initial value",
      };

      const getPersistedValues = vi.fn().mockReturnValue({
        "text-field": "User draft from localStorage",
      });

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData,
          getPersistedValues,
        })
      );

      expect(result.current["text-field"]).toBe("User draft from localStorage");
    });

    it("should use localStorage over initialData for textarea fields", () => {
      const uiElements = [
        createUIElement({
          id: "textarea-field",
          type: ExtendedUIFieldType.Textarea,
        }),
      ];

      const initialData = {
        "textarea-field": "Initial description",
      };

      const getPersistedValues = vi.fn().mockReturnValue({
        "textarea-field": "User's saved draft",
      });

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData,
          getPersistedValues,
        })
      );

      expect(result.current["textarea-field"]).toBe("User's saved draft");
    });

    it("should use localStorage over initialData for startup plan fields", () => {
      const uiElements = [
        createUIElement({
          id: "startup-plan-field",
          type: ExtendedUIFieldType.CodingPromptStartupPlan,
        }),
      ];

      const initialData = {
        "startup-plan-field": {
          responseType: "startup_plan_v1",
          sessionTitle: "Server plan",
          executionPlan: [],
          discrepancies: [],
          clarificationQuestions: [],
        },
      };

      const persistedValue = {
        responseType: "startup_plan_v1",
        sessionTitle: "Persisted plan",
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [],
        stepFeedback: [
          {
            stepId: "step-1",
            note: "Persist my draft",
          },
        ],
      };

      const getPersistedValues = vi.fn().mockReturnValue({
        "startup-plan-field": persistedValue,
      });

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData,
          getPersistedValues,
        })
      );

      expect(result.current["startup-plan-field"]).toEqual(persistedValue);
    });

    it("should fall back to initialData if localStorage is empty for user fields", () => {
      const uiElements = [
        createUIElement({
          id: "text-field",
          type: ExtendedUIFieldType.TextInput,
        }),
      ];

      const initialData = {
        "text-field": "Server-provided default",
      };

      const getPersistedValues = vi.fn().mockReturnValue({});

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData,
          getPersistedValues,
        })
      );

      expect(result.current["text-field"]).toBe("Server-provided default");
    });
  });

  describe("default values for different field types", () => {
    it("should default priority fields to 1", () => {
      const uiElements = [
        createUIElement({
          id: "priority-field",
          type: "priority",
        }),
      ];

      const getPersistedValues = vi.fn().mockReturnValue({});

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData: undefined,
          getPersistedValues,
        })
      );

      expect(result.current["priority-field"]).toBe(1);
    });

    it("should default number fields to 0", () => {
      const uiElements = [
        createUIElement({ id: "number-field", type: "number" }),
      ];

      const getPersistedValues = vi.fn().mockReturnValue({});

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData: undefined,
          getPersistedValues,
        })
      );

      expect(result.current["number-field"]).toBe(0);
    });

    it("should default currency fields to 0", () => {
      const uiElements = [
        createUIElement({
          id: "currency-field",
          type: "currency",
        }),
      ];

      const getPersistedValues = vi.fn().mockReturnValue({});

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData: undefined,
          getPersistedValues,
        })
      );

      expect(result.current["currency-field"]).toBe(0);
    });

    it('should default other fields to ""', () => {
      const uiElements = [
        createUIElement({
          id: "text-field",
          type: ExtendedUIFieldType.TextInput,
        }),
      ];

      const getPersistedValues = vi.fn().mockReturnValue({});

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData: undefined,
          getPersistedValues,
        })
      );

      expect(result.current["text-field"]).toBe("");
    });

    it("should leave an unanswered existing-work intent undefined", () => {
      const uiElements = [
        createUIElement({
          id: "repository_grounding_intent",
          type: ExtendedUIFieldType.Select,
        }),
      ];

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData: undefined,
          getPersistedValues: vi.fn().mockReturnValue({
            repository_grounding_intent: "",
          }),
        }),
      );

      expect(result.current.repository_grounding_intent).toBeUndefined();
    });

    it("preserves a typed existing-work intent while ignoring invalid drafts", () => {
      const uiElements = [
        createUIElement({
          id: "repository_grounding_intent",
          type: ExtendedUIFieldType.Select,
        }),
      ];

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData: { repository_grounding_intent: { choice: "no" } },
          getPersistedValues: vi.fn().mockReturnValue({
            repository_grounding_intent: "invalid",
          }),
        }),
      );

      expect(result.current.repository_grounding_intent).toEqual({
        choice: "no",
      });
    });
  });

  describe("mixed field types", () => {
    it("should handle forms with both system and user fields correctly", () => {
      const uiElements = [
        createUIElement({
          id: "stub-field",
          type: ExtendedUIFieldType.TaskStub,
        }),
        createUIElement({
          id: "feedback-field",
          type: ExtendedUIFieldType.Textarea,
        }),
      ];

      const initialData = {
        "stub-field": {
          type: "TASK_STUBS",
          stubs: [],
          response: "System data",
        },
        "feedback-field": "Initial feedback",
      };

      const getPersistedValues = vi.fn().mockReturnValue({
        "stub-field": "", // Should be ignored for system field
        "feedback-field": "User draft feedback", // Should win for user field
      });

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData,
          getPersistedValues,
        })
      );

      // System field uses initialData
      expect(result.current["stub-field"]).toEqual(initialData["stub-field"]);
      // User field uses localStorage
      expect(result.current["feedback-field"]).toBe("User draft feedback");
    });
  });

  describe("visual preview fields", () => {
    it("normalizes a stale empty-string draft into the typed review value", () => {
      const uiElements = [
        createUIElement({
          id: "visual-preview-field",
          type: ExtendedUIFieldType.PlanGenerationVisualPreview,
        }),
      ];

      const { result } = renderHook(() =>
        useFormDefaultValues({
          isSubmitted: false,
          uiElements,
          initialData: {
            "visual-preview-field": { payload: { feedback: "" } },
          },
          getPersistedValues: () => ({ "visual-preview-field": "" }),
        }),
      );

      expect(result.current["visual-preview-field"]).toEqual({
        payload: { feedback: "" },
      });
    });
  });
});
