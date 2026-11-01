import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { getEntityIcon } from "../../../utils/entityIcons";
import { DecisionIcon } from "../../../utils/icons/Decision";
import {
  ProposalHeader,
  type ProposalHeaderTypePresentation,
} from "../ProposalHeader";
import {
  resolveEffectiveTaskType,
  resolveWorkItemTypeColors,
  resolveWorkItemTypePresentation,
} from "../proposalHeaderType";

const typePresentation: ProposalHeaderTypePresentation = {
  kind: "available",
  label: "Research Brief",
  Icon: getEntityIcon("task"),
};
const proposal = (action: ProposalAction): ProposalResponseDto =>
  ({
    id: "proposal",
    organizationId: "organization",
    projectId: "project",
    type: ProposalType.Single,
    action,
    status: ProposalStatus.Draft,
    targetEntityId: "target",
    targetEntityType: TargetEntityType.Task,
    updates: {},
    requestorId: "user",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }) as ProposalResponseDto;
afterEach(cleanup);

describe("ProposalHeader metadata", () => {
  it("retains deferred timing when the comparison projects an ordinary update", () => {
    render(
      <ProposalHeader
        proposal={proposal(ProposalAction.Update)}
        presentationAction={ProposalAction.VersionedUpdate}
        typePresentation={typePresentation}
      />,
    );
    expect(screen.getByTestId("proposal-header-action")).toHaveTextContent(
      "Updates after linked work",
    );
    expect(screen.getByTestId("proposal-header-type")).toHaveTextContent(
      "Research Brief",
    );
  });

  it("shows timing on grouped future headers and preserves cancellation wording", () => {
    const future = {
      ...proposal(ProposalAction.VersionedUpdate),
      updates: { operation: "REVISE" },
    };
    const { rerender } = render(
      <ProposalHeader proposal={future} typePresentation={typePresentation} />,
    );
    expect(screen.getByTestId("proposal-header-action")).toHaveTextContent(
      "Updates after linked work",
    );
    rerender(
      <ProposalHeader
        proposal={{ ...future, updates: { operation: "CANCEL" } }}
        typePresentation={typePresentation}
      />,
    );
    expect(screen.getByTestId("proposal-header-action")).toHaveTextContent(
      "Future revision",
    );
  });

  it.each([
    [ProposalAction.Create, "Create"],
    [ProposalAction.Update, "Update"],
    [ProposalAction.Delete, "Delete"],
  ])("renders %s without owning title markup", (action, label) => {
    render(
      <ProposalHeader
        proposal={proposal(action)}
        typePresentation={typePresentation}
      />,
    );
    expect(screen.getByTestId("proposal-header-action")).toHaveTextContent(
      label,
    );
    expect(screen.getByTestId("proposal-header-type")).toHaveTextContent(
      "Research Brief",
    );
    expect(screen.queryByTestId("proposal-title")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("proposal header task-type resolution", () => {
  it("uses proposed type for CREATE and loaded type otherwise", () => {
    expect(
      resolveEffectiveTaskType({ kind: "create", proposedType: "CONTRACT" }),
    ).toBe("CONTRACT");
    expect(
      resolveEffectiveTaskType({ kind: "existing", loadedType: "CUSTOM" }),
    ).toBe("CUSTOM");
  });
  it("resolves custom colors", () => {
    expect(resolveWorkItemTypeColors("STANDARD")).toBeDefined();
    expect(resolveWorkItemTypePresentation).toBeDefined();
  });

  it("uses the matching definition's icon key for proposal icon and color", () => {
    const decisionDefinition: WorkItemTypeDefinitionDto = {
      key: "decision",
      name: "Decision",
      sections: [],
      allowedStatuses: [],
      iconKey: "decision",
    };
    const presentation = resolveWorkItemTypePresentation(
      "decision",
      decisionDefinition,
    );

    expect(presentation).toMatchObject({
      kind: "available",
      label: "Decision",
      Icon: DecisionIcon,
      colors: { background: "success.main", color: "success.contrastText" },
    });
    expect(
      resolveWorkItemTypeColors("mockup", {
        key: "mockup",
        name: "Mockup",
        sections: [],
        allowedStatuses: [],
        iconKey: "design",
      }),
    ).toEqual({
      background: "error.main",
      color: "error.contrastText",
    });
  });

  it("withholds type-specific proposal icon and color for a mismatched definition", () => {
    const presentation = resolveWorkItemTypePresentation("decision", {
      key: "mockup",
      name: "Mockup",
      sections: [],
      allowedStatuses: [],
      iconKey: "design",
    });

    expect(presentation).toMatchObject({
      kind: "available",
      Icon: getEntityIcon("task"),
    });
    expect(presentation).not.toHaveProperty("colors");
  });
});
