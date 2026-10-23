import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  type ProposalResponseDto,
} from "../../../api";
import { ProposalPlacementBlock } from "../ProposalPlacementBlock";

const useFullEntityContextMock = vi.hoisted(() => vi.fn());
const lookupState = vi.hoisted(() => ({ isLoading: false }));
const cachedFeatures = vi.hoisted(
  () =>
    new Map<string, { name: string; parentTaskId: string | null }>([
      ["feature-root", { name: "Root", parentTaskId: null }],
      ["feature-child", { name: "Child", parentTaskId: "feature-root" }],
    ])
);

vi.mock("../../../data/hooks/useFullEntityContext", () => ({
  useFullEntityContext: (...args: unknown[]) =>
    useFullEntityContextMock(...args),
}));

vi.mock("../../../data/hooks/useFeatureHierarchy", () => ({
  useFeatureLookup: () => ({
    isReady: !lookupState.isLoading,
    isLoading: lookupState.isLoading,
    get: (id: string) => {
      if (lookupState.isLoading) return undefined;
      const feature = cachedFeatures.get(id);
      return feature ? { id, ...feature } : undefined;
    },
    resolveAncestry: () => ({ ancestors: [], complete: false }),
  }),
}));

vi.mock("../../Features/FeatureTreeVisualization", () => ({
  default: ({ focusedFeatureId }: { focusedFeatureId: string }) => (
    <div data-testid="feature-tree" data-focused-feature-id={focusedFeatureId} />
  ),
}));

const buildUpdateProposal = (targetEntityId: string) =>
  ({
    id: "proposal-1",
    action: ProposalAction.Update,
    targetEntityId,
    targetEntityType: "TASK",
    updates: {},
  }) as unknown as ProposalResponseDto;

const renderBlock = (targetEntityId: string) =>
  render(
    <ProposalPlacementBlock
      organizationId="org-1"
      projectId="project-1"
      proposal={buildUpdateProposal(targetEntityId)}
    />
  );

describe("ProposalPlacementBlock", () => {
  beforeEach(() => {
    lookupState.isLoading = false;
    useFullEntityContextMock.mockReset();
    useFullEntityContextMock.mockReturnValue({ data: null, isLoading: false });
  });

  it("reads a feature target's parent from the cached hierarchy", async () => {
    renderBlock("feature-child");

    expect(await screen.findByTestId("feature-tree")).toHaveAttribute(
      "data-focused-feature-id",
      "feature-root"
    );
    expect(useFullEntityContextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it("shows no parent for a cached root feature without the context read", () => {
    renderBlock("feature-root");

    expect(screen.getByText("No parent feature.")).toBeInTheDocument();
    expect(useFullEntityContextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it("keeps the context read for non-feature targets", async () => {
    useFullEntityContextMock.mockReturnValue({
      data: {
        featureHierarchy: [
          {
            id: "server-parent",
            name: "Server Parent",
            relationshipType: "structural",
            relationship: "ancestor",
            distance: 1,
          },
        ],
      },
      isLoading: false,
    });

    renderBlock("task-1");

    expect(useFullEntityContextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, entityId: "task-1" })
    );
    expect(await screen.findByTestId("feature-tree")).toHaveAttribute(
      "data-focused-feature-id",
      "server-parent"
    );
  });

  it("waits for the cached hierarchy before reading context", () => {
    lookupState.isLoading = true;

    renderBlock("feature-child");

    expect(useFullEntityContextMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});
