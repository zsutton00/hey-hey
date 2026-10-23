import { describe, expect, it } from "vitest";
import {
  ExtendedUIFieldType,
  FeatureTag,
  MessageStatus,
  MessageType,
  type MessageResponseDto,
  type RepositoryPlacementReviewElement,
  type UIElement,
} from "../../../../api";
import type { ConversationMessage } from "../../../../types/conversation";
import {
  FIELD_REGISTRY,
  getFormVisibilityOverride,
  getRegistryType,
} from "../Registry";
import { getFieldResponseMetadata } from "../fieldResponseMetadata";

const createElement = (id: string, type: UIElement["type"]): UIElement => ({
  id,
  type,
  label: "Field",
});

describe("getRegistryType", () => {
  it("maps standard ui element types through TYPE_MAPPING", () => {
    const element = createElement("field-1", ExtendedUIFieldType.TextInput);
    expect(getRegistryType(element)).toBe("text");
  });

  it("routes final assessment marker to dedicated structured registry type", () => {
    const element = createElement(
      "final-assessment-id",
      ExtendedUIFieldType.CodingPromptFinalAssessment
    );

    expect(getRegistryType(element)).toBe("coding_prompt_final_assessment");
  });

  it("routes final assessment v1 marker to dedicated structured registry type", () => {
    const element = createElement(
      "final-assessment-v1-id",
      ExtendedUIFieldType.CodingPromptFinalAssessment
    );

    expect(getRegistryType(element)).toBe("coding_prompt_final_assessment");
  });

  it("routes startup plan marker to dedicated structured registry type", () => {
    const element = createElement(
      "startup-plan-id",
      ExtendedUIFieldType.CodingPromptStartupPlan
    );

    expect(getRegistryType(element)).toBe("coding_prompt_startup_plan");
  });

  it("keeps plan document ui element type mapped directly", () => {
    expect(getRegistryType("plan_document_view")).toBe("plan_document_view");
  });

  it("agent_response ui elements do not override form visibility, so secondary action buttons can still render", () => {
    const element = createElement(
      "agent-response-generic",
      ExtendedUIFieldType.AgentResponse
    );

    const override = getFormVisibilityOverride([element]);

    expect(override).toBeUndefined();
  });

  it("maps agent-request-permission element type to agent_response registry", () => {
    expect(getRegistryType("agent-request-permission")).toBe(
      "agent_request_permission"
    );
    expect(getRegistryType("agent_request_permission")).toBe(
      "agent_request_permission"
    );
  });

  it("resolves plan_generation_stage_review string directly through the registry", () => {
    expect(getRegistryType("plan_generation_stage_review")).toBe(
      "plan_generation_stage_review"
    );
  });

  it("resolves plan_generation_step_review string directly through the registry", () => {
    expect(getRegistryType("plan_generation_step_review")).toBe(
      "plan_generation_step_review"
    );
  });

  it("resolves plan_generation_finalize string directly through the registry", () => {
    expect(getRegistryType("plan_generation_finalize")).toBe(
      "plan_generation_finalize"
    );
  });

  it("maps PlanGenerationFinalize ExtendedUIFieldType to the registry entry", () => {
    const element = createElement(
      "plan-generation-finalize-id",
      ExtendedUIFieldType.PlanGenerationFinalize
    );

    expect(getRegistryType(element)).toBe("plan_generation_finalize");
  });

  it("keeps agent_hidden mapped to the no-op registry field", () => {
    const element = createElement(
      "agent-hidden-noop",
      ExtendedUIFieldType.AgentHidden
    );

    expect(getRegistryType(element)).toBe("agent_hidden");
  });

  it("maps repository-grounding aliases to the reusable field adapter", () => {
    expect(getRegistryType("repository_grounding")).toBe(
      "repository_grounding"
    );
    expect(getRegistryType("repository_prerequisites")).toBe(
      "repository_grounding"
    );
    expect(getRegistryType("repository_analysis")).toBe("repository_grounding");
    expect(
      FIELD_REGISTRY.repository_grounding.shouldShowButtons?.(undefined)
    ).toBe(false);
  });

  it("maps the generated repository placement review type directly", () => {
    const element = createElement(
      "repository-placement-review",
      ExtendedUIFieldType.RepositoryPlacementReview
    );

    expect(getRegistryType(element)).toBe("repository_placement_review");
    expect(getRegistryType("repository_placement_review")).toBe(
      "repository_placement_review"
    );
  });

  it("classifies implementation readiness as a visible composer contribution", () => {
    const source: MessageResponseDto = {
      id: "readiness-message",
      projectId: "project",
      conversationId: "conversation",
      createdAt: "2026-09-28T00:00:00Z",
      type: MessageType.System,
      status: MessageStatus.Open,
      awaitingResponse: true,
      responses: [],
      data: {
        type: "QUESTIONS",
        uiElements: [
          createElement(
            "readiness",
            ExtendedUIFieldType.ImplementationReadiness
          ),
        ],
      },
    };
    const conversationMessage: ConversationMessage = {
      message: source,
      state: "awaiting_response",
      canEdit: true,
    };
    const metadata = getFieldResponseMetadata("implementation_readiness");

    expect(metadata.responseBehavior).toEqual({
      ownership: "contribution",
      submissionKind: "field",
    });
    expect(metadata.shouldShowForm?.({ conversationMessage })).toBe(true);
  });

  it("initializes a complete authored placement review submission", () => {
    const element: RepositoryPlacementReviewElement = {
      id: "repository-placement-review",
      type: ExtendedUIFieldType.RepositoryPlacementReview,
      label: "Review placement",
      payload: {
        roots: [
          {
            root: {
              rootKey: "root-one",
              name: "Reporting",
              description: "Reporting capability",
              tag: FeatureTag.Product,
              children: [],
            },
            selectedParent: { kind: "PROJECT_ROOT" },
            selectedParentLineage: [],
          },
        ],
      },
    };
    const entry = FIELD_REGISTRY.repository_placement_review;
    const value = entry.prepareInitialValue?.({
      uiElement: element,
      baseValue: undefined,
      messageData: {
        type: "QUESTIONS",
        response: "Review placement",
        uiElements: [element],
      },
    });

    expect(value).toEqual({
      action: "APPROVED",
      payload: {
        overrides: [{ rootKey: "root-one", target: { kind: "PROJECT_ROOT" } }],
      },
    });
    expect(entry.getHasContent(value)).toBe(true);
  });

  it("repairs an incomplete placement review submission from the review payload", () => {
    const element: RepositoryPlacementReviewElement = {
      id: "repository-placement-review",
      type: ExtendedUIFieldType.RepositoryPlacementReview,
      label: "Review placement",
      payload: {
        roots: [
          {
            root: {
              rootKey: "root-one",
              name: "Reporting",
              description: "Reporting capability",
              tag: FeatureTag.Product,
              children: [],
            },
            selectedParent: { kind: "PROJECT_ROOT" },
            selectedParentLineage: [],
          },
          {
            root: {
              rootKey: "root-two",
              name: "Alerts",
              description: "Alerting capability",
              tag: FeatureTag.Product,
              children: [],
            },
            selectedParent: { kind: "PROJECT_ROOT" },
            selectedParentLineage: [],
          },
        ],
      },
    };
    const entry = FIELD_REGISTRY.repository_placement_review;
    const value = entry.prepareInitialValue?.({
      uiElement: element,
      baseValue: {
        action: "APPROVED",
        payload: {
          overrides: [
            {
              rootKey: "root-one",
              target: {
                kind: "EXISTING_FEATURE",
                featureId: "11111111-1111-4111-8111-111111111111",
              },
            },
          ],
        },
      },
      messageData: {
        type: "QUESTIONS",
        response: "Review placement",
        uiElements: [element],
      },
    });

    expect(value).toEqual({
      action: "APPROVED",
      payload: {
        overrides: [
          {
            rootKey: "root-one",
            target: {
              kind: "EXISTING_FEATURE",
              featureId: "11111111-1111-4111-8111-111111111111",
            },
          },
          { rootKey: "root-two", target: { kind: "PROJECT_ROOT" } },
        ],
      },
    });
    expect(
      entry.getHasContent({ action: "APPROVED", payload: { overrides: [] } })
    ).toBe(false);
  });

  it("routes only the existing-work intent element to its typed field", () => {
    expect(
      getRegistryType(
        createElement("repository_grounding_intent", ExtendedUIFieldType.Select)
      )
    ).toBe("repository_grounding_intent");
    expect(
      getRegistryType(createElement("other-select", ExtendedUIFieldType.Select))
    ).toBe("select");
    expect(getRegistryType("repository_grounding_intent")).toBe(
      "repository_grounding_intent"
    );
    expect(
      FIELD_REGISTRY.repository_grounding_intent.getHasContent(undefined)
    ).toBe(false);
    expect(
      FIELD_REGISTRY.repository_grounding_intent.getHasContent({
        choice: "yes",
      })
    ).toBe(true);
  });
});
