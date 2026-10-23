import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
} from "../../../api";
import { ProposalTitle } from "../ProposalTitle";
import type { EntityLinkWithPreviewProps } from "../../Entity/EntityLinkWithPreview";
import { staticProposalEntityTypePresentation } from "../proposalHeaderType";

const { interaction, preview } = vi.hoisted(() => ({
  interaction: vi.fn(),
  preview: vi.fn(),
}));
vi.mock("../../InteractionComponent", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../InteractionComponent")
  >();
  return {
    ...actual,
    InteractionComponent: (props: {
      children: ReactNode;
      entityId: string;
      entityType: string;
      hasProposalSupport: boolean;
      entityTitle?: string;
      organizationId?: string;
      projectId?: string;
      draggable?: boolean;
    }) => {
      interaction(props);
      return <span data-testid="title-interaction">{props.children}</span>;
    },
  };
});
vi.mock("../../Entity", () => ({
  EntityLinkWithPreview: (props: EntityLinkWithPreviewProps) => {
    preview(props);
    return (
      <a href={props.href} data-testid={props.testId}>
        {props.label}
      </a>
    );
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const proposal = (
  action: ProposalAction = ProposalAction.Update
): ProposalResponseDto =>
  ({
    id: "proposal",
    organizationId: "organization",
    projectId: "project",
    type: ProposalType.Single,
    action,
    status: ProposalStatus.Draft,
    targetEntityId: "target",
    targetEntityType: TargetEntityType.Task,
    title: "Reporting",
    updates: {},
    requestorId: "user",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as ProposalResponseDto);
const typePresentation = staticProposalEntityTypePresentation(
  TargetEntityType.Task
);

describe("ProposalTitle", () => {
  it("passes the plain title typography to the entity link", () => {
    render(
      <ProposalTitle
        proposal={proposal()}
        typePresentation={typePresentation}
      />
    );

    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        sx: expect.arrayContaining([
          expect.objectContaining({ typography: "subtitle2" }),
        ]),
      })
    );
  });

  it("shows stored ELI5 below the title and leaves legacy proposals without a line", () => {
    render(
      <>
        <ProposalTitle
          proposal={{ ...proposal(), eli5: "Explains the change quickly." }}
          typePresentation={typePresentation}
        />
        <ProposalTitle
          proposal={proposal()}
          typePresentation={typePresentation}
        />
      </>
    );
    expect(screen.getAllByTestId("proposal-eli5")).toHaveLength(1);
    expect(screen.getByTestId("proposal-eli5")).toHaveTextContent(
      "Explains the change quickly."
    );
  });
  it("always renders an UPDATE title as an entity-preview link", () => {
    render(
      <ProposalTitle
        proposal={proposal()}
        typePresentation={typePresentation}
      />
    );
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "target",
        entityType: TargetEntityType.Task,
      })
    );
  });

  it("owns linked delete treatment and metadata", () => {
    render(
      <ProposalTitle
        proposal={proposal(ProposalAction.Delete)}
        typePresentation={typePresentation}
      />
    );
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "target",
        sx: expect.arrayContaining([
          expect.objectContaining({ textDecoration: "line-through" }),
        ]),
      })
    );
    expect(screen.getByTestId("proposal-header-action")).toHaveTextContent(
      "Delete"
    );
  });

  it("keeps a CREATE title plain until a concrete created target is supplied", () => {
    render(
      <ProposalTitle
        proposal={proposal(ProposalAction.Create)}
        typePresentation={typePresentation}
      />
    );
    expect(screen.getByTestId("proposal-title")).toHaveTextContent("Reporting");
    expect(preview).not.toHaveBeenCalled();
  });

  it("links an approved CREATE directly from proposal status", () => {
    render(
      <ProposalTitle
        proposal={{
          ...proposal(ProposalAction.Create),
          status: ProposalStatus.Approved,
        }}
        typePresentation={typePresentation}
      />
    );
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: "target" })
    );
    expect(interaction).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "target",
        entityType: TargetEntityType.Task,
        hasProposalSupport: true,
        draggable: true,
        entityTitle: "Reporting",
        projectId: "project",
      })
    );
    expect(screen.getByTestId("title-interaction")).toContainElement(
      screen.getByTestId("proposal-title")
    );
    expect(screen.getByTestId("title-interaction")).not.toContainElement(
      screen.getByTestId("proposal-header-action")
    );
    expect(screen.getByTestId("proposal-title-layout")).toHaveStyle({
      flex: "1 1 0%",
      minWidth: "0",
    });
  });

  it("links a materialized custom-task CREATE with an entity preview", () => {
    render(
      <ProposalTitle
        proposal={proposal(ProposalAction.Create)}
        resolvedTargetName="Resolved reporting"
        typePresentation={typePresentation}
        target={{
          entityId: "reporting",
          entityType: TargetEntityType.Task,
          href: "/features/reporting",
          sx: { fontSize: "16px" },
        }}
        titleSx={{ fontSize: "18px" }}
      />
    );
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Resolved reporting",
        entityId: "reporting",
        href: "/features/reporting",
        sx: expect.arrayContaining([
          { fontSize: "16px" },
          { fontSize: "18px" },
        ]),
      })
    );
  });

  it("makes an approved UPDATE title draggable using the materialized entity", () => {
    render(
      <ProposalTitle
        proposal={{
          ...proposal(ProposalAction.Update),
          id: "proposal-id",
          targetEntityId: "materialized-task",
          status: ProposalStatus.Approved,
        }}
        typePresentation={typePresentation}
      />
    );

    expect(interaction).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "materialized-task",
        entityType: TargetEntityType.Task,
        draggable: true,
      })
    );
  });

  it.each([
    [ProposalStatus.Draft, ProposalAction.Update],
    [ProposalStatus.Rejected, ProposalAction.Update],
    [ProposalStatus.Approved, ProposalAction.Delete],
  ] as const)("does not make %s %s titles interactive", (status, action) => {
    render(
      <ProposalTitle
        proposal={{
          ...proposal(action),
          status,
        }}
        typePresentation={typePresentation}
      />
    );

    expect(interaction).not.toHaveBeenCalled();
  });

  it("keeps approved targets without a structural parent path menuable but not draggable", () => {
    render(
      <ProposalTitle
        proposal={{
          ...proposal(ProposalAction.Update),
          status: ProposalStatus.Approved,
          targetEntityType: TargetEntityType.Conversation,
        }}
        typePresentation={staticProposalEntityTypePresentation(
          TargetEntityType.Conversation
        )}
      />
    );

    expect(interaction).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "target",
        entityType: TargetEntityType.Conversation,
        hasProposalSupport: true,
        draggable: false,
      })
    );
  });

  it("does not create an entity interaction for an unresolved target", () => {
    render(
      <ProposalTitle
        proposal={{
          ...proposal(ProposalAction.Create),
          status: ProposalStatus.Approved,
          targetEntityId: "00000000-0000-0000-0000-000000000000",
        }}
        typePresentation={typePresentation}
      />
    );

    expect(interaction).not.toHaveBeenCalled();
    expect(screen.getByTestId("proposal-title")).toHaveTextContent("Reporting");
  });
});
