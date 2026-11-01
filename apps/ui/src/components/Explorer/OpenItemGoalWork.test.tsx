import { EntityType } from "@hey-hey/ui-common/api";
import { useOpenItemGoalWork } from "@hey-hey/ui-common/data";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenItemGoalWork } from "./OpenItemGoalWork";

vi.mock("@hey-hey/ui-common/data", () => ({ useOpenItemGoalWork: vi.fn() }));
vi.mock("../../contexts/OpenItemsContext", () => ({
  useOpenItems: () => ({ setGoalFilter: vi.fn() }),
}));

describe("OpenItemGoalWork", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [EntityType.Task, "task"],
    [EntityType.DesignDoc, "design_doc"],
    [EntityType.Initiative, "initiative"],
    [EntityType.Conversation, "conversation"],
  ] as const)(
    "passes %s tracked work to the nested item renderer",
    (entityType, openItemType) => {
      vi.mocked(useOpenItemGoalWork).mockReturnValue({
        work: [
          {
            targetEntityType: entityType,
            targetEntityId: "tracked-work",
            title: "Tracked work",
          },
        ],
        isLoading: false,
        error: null,
        retry: vi.fn(),
      });
      const renderItem = vi.fn(() => null);
      render(
        <OpenItemGoalWork
          organizationId="org"
          projectId="project"
          goalId="goal"
          filter="ACTIVE"
          depth={1}
          renderItem={renderItem}
        />,
      );
      expect(renderItem).toHaveBeenCalledWith(
        {
          entityType: openItemType,
          entityId: "tracked-work",
          title: "Tracked work",
          lineage: undefined,
        },
        2,
      );
    },
  );

  it("does not turn unsupported tracked entity kinds into open items", () => {
    vi.mocked(useOpenItemGoalWork).mockReturnValue({
      work: [
        {
          targetEntityType: EntityType.Service,
          targetEntityId: "service",
          title: "Service",
        },
      ],
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });
    const renderItem = vi.fn(() => null);
    render(
      <OpenItemGoalWork
        organizationId="org"
        projectId="project"
        goalId="goal"
        filter="ACTIVE"
        depth={1}
        renderItem={renderItem}
      />,
    );
    expect(renderItem).not.toHaveBeenCalled();
  });
});
