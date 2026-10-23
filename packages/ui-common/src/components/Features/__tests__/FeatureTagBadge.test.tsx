import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DndContext } from "@dnd-kit/core";
import {
  FeatureTag,
  TaskSource,
  WorkStatus,
  type TaskResponseDto,
} from "../../../api";
import { FeatureTagBadge } from "../FeatureTagBadge";
import { FeatureTreeNode } from "../FeatureTreeNode";
import {
  FEATURE_TAG_PALETTE,
  FEATURE_TAG_VALUES,
  UNSET_FEATURE_TAG_LABEL,
} from "../featureTagPalette";

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";

function makeFeature(
  overrides: Partial<TaskResponseDto> = {}
): TaskResponseDto {
  return {
    id: "feat-1",
    name: "Feature 1",
    type: "FEATURE",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    status: WorkStatus.Open,
    source: TaskSource.User,
    ...overrides,
  } as TaskResponseDto;
}

describe("FeatureTagBadge", () => {
  it.each(FEATURE_TAG_VALUES)("renders the %s label", (tag) => {
    render(<FeatureTagBadge tag={tag} />);
    expect(
      screen.getByText(FEATURE_TAG_PALETTE[tag].label)
    ).toBeInTheDocument();
  });

  it("renders the unset state when tag is null", () => {
    render(<FeatureTagBadge tag={null} />);
    expect(screen.getByText(UNSET_FEATURE_TAG_LABEL)).toBeInTheDocument();
  });

  it("renders the unset state when tag is undefined", () => {
    render(<FeatureTagBadge tag={undefined} />);
    expect(screen.getByText(UNSET_FEATURE_TAG_LABEL)).toBeInTheDocument();
  });

  it("renders the loading variant", () => {
    render(<FeatureTagBadge tag={FeatureTag.Product} loading />);
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(screen.getByLabelText("Saving feature tag")).toBeInTheDocument();
  });

  it("renders the error variant", () => {
    render(<FeatureTagBadge tag={FeatureTag.Product} error="boom" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Tag failed")).toBeInTheDocument();
  });
});

describe("FeatureTreeNode — tag rendering", () => {
  function renderNode(tag: FeatureTag | null | undefined) {
    return render(
      <DndContext>
        <FeatureTreeNode
          feature={makeFeature({ tag: tag ?? undefined })}
          isHighlighted={false}
          isActive={false}
          hasChildren={false}
          isCollapsed={false}
          taskCount={2}
          onToggleCollapse={() => {}}
          onClick={() => {}}
          href="/x"
          descendantsOfActive={new Set<string>()}
          onReparentDrop={() => {}}
        />
      </DndContext>
    );
  }

  it.each(FEATURE_TAG_VALUES)(
    "shows the compact %s label on the tree node",
    (tag) => {
      renderNode(tag);
      expect(
        screen.getByText(FEATURE_TAG_PALETTE[tag].shortLabel)
      ).toBeInTheDocument();
    }
  );

  it("renders the unset state without breaking layout", () => {
    renderNode(undefined);
    expect(screen.getByLabelText(UNSET_FEATURE_TAG_LABEL)).toBeInTheDocument();
    expect(screen.getByText("2 tasks")).toBeInTheDocument();
  });
});
