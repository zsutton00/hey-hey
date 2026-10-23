import {
  DiagramKind,
  DiagramLevel,
  DiagramReferenceTargetRuleEntityTypeEnum,
  type DiagramElementPolicy,
} from "../../../api";
import {
  DiagramElementFields,
  isValidDiagramElementMetadata,
  isValidDiagramMetadata,
  parseDiagramElementMetadata,
  parseDiagramMetadata,
} from "../DiagramFields";
import { createElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const policy: DiagramElementPolicy = {
  roles: [
    { key: "GENERIC", label: "Generic", notation: "box" },
    { key: "START", label: "Start", notation: "box" },
    { key: "END", label: "End", notation: "box" },
    { key: "DIAGRAM_REFERENCE", label: "Diagram reference", notation: "frame" },
  ],
  referenceTargets: [
    {
      entityType: DiagramReferenceTargetRuleEntityTypeEnum.Task,
      workItemTypeKeys: ["DIAGRAM"],
    },
    { entityType: DiagramReferenceTargetRuleEntityTypeEnum.Service },
  ],
};

describe("DiagramFields mappings", () => {
  it.each(["START", "END"])(
    "selects %s and preserves the existing reference when reopening",
    (role) => {
      const onChange = vi.fn();
      const value = { role: "GENERIC", canonicalReference: null };
      const client = new QueryClient();
      const view = render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(DiagramElementFields, {
            value,
            policy,
            organizationId: null,
            projectId: null,
            onChange,
          })
        )
      );
      fireEvent.mouseDown(
        screen.getByRole("combobox", { name: "Element role" })
      );
      fireEvent.click(
        screen.getByRole("option", {
          name: `${role === "START" ? "Start" : "End"} (box)`,
        })
      );
      expect(onChange).toHaveBeenCalledWith({ role, canonicalReference: null });
      view.rerender(
        createElement(
          QueryClientProvider,
          { client },
          createElement(DiagramElementFields, {
            value: { role, canonicalReference: null },
            policy,
            organizationId: null,
            projectId: null,
            onChange,
          })
        )
      );
      expect(
        screen.getByRole("combobox", { name: "Element role" })
      ).toHaveTextContent(role === "START" ? "Start" : "End");
    }
  );
  it.each(["START", "END"])(
    "reopens explicit %s metadata without coercion",
    (role) => {
      const metadata = { role, canonicalReference: null };
      expect(parseDiagramElementMetadata(metadata)).toEqual(metadata);
      expect(isValidDiagramElementMetadata(metadata, policy)).toBe(true);
    }
  );
  it("uses canonical defaults and rejects non-architecture C4 levels", () => {
    expect(parseDiagramMetadata(null)).toEqual({
      kind: DiagramKind.General,
      level: DiagramLevel.Overview,
    });
    expect(
      isValidDiagramMetadata({
        kind: DiagramKind.General,
        level: DiagramLevel.Container,
      })
    ).toBe(false);
    expect(
      isValidDiagramMetadata({
        kind: DiagramKind.Architecture,
        level: DiagramLevel.Container,
      })
    ).toBe(true);
  });

  it("enforces both directions of the diagram-reference rule without coercing values", () => {
    const diagram = {
      entityId: "diagram-id",
      entityType: DiagramReferenceTargetRuleEntityTypeEnum.Task,
    };
    expect(
      isValidDiagramElementMetadata(
        { role: "GENERIC", canonicalReference: diagram },
        policy
      )
    ).toBe(false);
    expect(
      isValidDiagramElementMetadata({ role: "DIAGRAM_REFERENCE" }, policy)
    ).toBe(false);
    expect(
      isValidDiagramElementMetadata(
        { role: "DIAGRAM_REFERENCE", canonicalReference: diagram },
        policy
      )
    ).toBe(true);
    expect(
      parseDiagramElementMetadata({ role: "CUSTOM", canonicalReference: null })
    ).toEqual({ role: "CUSTOM", canonicalReference: null });
  });

  it("allows configured non-task canonical targets", () => {
    expect(
      isValidDiagramElementMetadata(
        {
          role: "GENERIC",
          canonicalReference: {
            entityId: "service-id",
            entityType: DiagramReferenceTargetRuleEntityTypeEnum.Service,
          },
        },
        policy
      )
    ).toBe(true);
  });
});
