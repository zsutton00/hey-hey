import { DesignDocTemplate } from "@hey-hey/ui-common/api";
import type { DesignDocResponseDto } from "@hey-hey/ui-common/api";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { DocumentEditor } from "./DocumentEditor";

const mockPlanDocumentEditor = vi.fn();

vi.mock("@hey-hey/ui-common/components", () => ({
  AdrEditor: () => <div>ADR editor</div>,
  BrainstormEditor: () => <div>Brainstorm editor</div>,
  DecisionEditor: () => <div>Decision editor</div>,
  PlanDocumentEditor: (props: {
    onDone?: (designDocId: string) => void;
    designDocId: string;
  }) => {
    mockPlanDocumentEditor(props);
    return <div>Plan document editor</div>;
  },
}));

const createDesignDoc = (
  overrides: Partial<DesignDocResponseDto> = {},
): DesignDocResponseDto =>
  ({
    id: "design-doc-1",
    name: "Document",
    summary: "Summary",
    sections: [],
    status: "READY",
    template: DesignDocTemplate.Adr,
    ...overrides,
  }) as DesignDocResponseDto;

describe("DocumentEditor", () => {
  it("renders the plan document editor for PLAN_DOCUMENT templates", () => {
    const onDone = vi.fn();
    render(
      <DocumentEditor
        currentOrgId="org-1"
        projectId="project-1"
        documentData={createDesignDoc({
          template: DesignDocTemplate.PlanDocument,
        })}
        onDone={onDone}
      />,
    );

    expect(screen.getByText("Plan document editor")).toBeInTheDocument();
    const props = mockPlanDocumentEditor.mock.calls[0][0];
    props.onDone?.(props.designDocId);
    expect(onDone).toHaveBeenCalledWith("design-doc-1");
  });
});
