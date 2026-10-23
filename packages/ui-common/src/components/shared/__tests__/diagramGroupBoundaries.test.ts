import { describe, expect, it } from "vitest";
import {
  buildDiagramLayoutGroupHints,
  computeBoundaryBoxes,
  DIAGRAM_BOUNDARY_LABEL_HEIGHT,
  DIAGRAM_BOUNDARY_PADDING,
  parseDiagramGroups,
  resolveDiagramGroupMemberNodeId,
  serializeDiagramGroups,
  resolveDiagramGroupColors,
  DIAGRAM_GROUP_COLOR_ORDER,
} from "../diagramGroupBoundaries";
import {
  CHECKOUT_API_SERVICE_ID,
  DIAGRAM_GROUP_FIXTURE_NODE_SIZE,
  DIAGRAM_GROUP_FIXTURE_PAIRS,
  diagramGroupFixtureSection,
} from "../__fixtures__/diagramGroupFixtures";

const deployment = DIAGRAM_GROUP_FIXTURE_PAIRS.find(
  (pair) => pair.key === "aws-gcp-deployment"
)!;
const size = DIAGRAM_GROUP_FIXTURE_NODE_SIZE;
const rects = (positions: Record<string, [number, number]>) =>
  Object.entries(positions).map(([id, [x, y]]) => ({
    id,
    x,
    y,
    width: size,
    height: size,
  }));
const [shopper, dns, apiEast, dbEast, apiWest, dbWest, payments] =
  deployment.grouped.elements.map((element) => element.id);
const saved = rects({
  [shopper!]: [0, 200],
  [dns!]: [250, 200],
  [apiEast!]: [600, 0],
  [dbEast!]: [850, 0],
  [apiWest!]: [600, 500],
  [dbWest!]: [850, 500],
  [payments!]: [1200, 250],
});

describe("diagram group boundaries", () => {
  it("reserves authored identities and wraps only after unused colors are exhausted", () => {
    const automatic = Array.from({ length: 8 }, (_, index) => ({
      id: `phase-${index}`,
      label: "Phase",
      meaning: "VISUAL_ASSOCIATION" as const,
      members: [],
    }));
    const groups = [
      ...automatic,
      { ...automatic[0]!, id: "aws-a", color: "blue" as const },
      { ...automatic[0]!, id: "aws-b", color: "blue" as const },
    ];
    const colors = resolveDiagramGroupColors(groups);
    expect(colors.get("aws-a")).toBe("blue");
    expect(colors.get("aws-b")).toBe("blue");
    expect(automatic.map((group) => colors.get(group.id))).toEqual([
      "green",
      "orange",
      "purple",
      "red",
      "teal",
      "blue",
      "green",
      "orange",
    ]);
    expect(resolveDiagramGroupColors([...groups].reverse())).toEqual(colors);
    const fullyAuthored = DIAGRAM_GROUP_COLOR_ORDER.map((color) => ({
      ...automatic[0]!,
      id: color,
      color,
    }));
    expect(
      resolveDiagramGroupColors([...fullyAuthored, automatic[0]!]).get(
        "phase-0"
      )
    ).toBe("blue");
  });

  it("assigns invisible groups before deriving boxes and preserves color round trips", () => {
    const groups = deployment.grouped.groups;
    expect(
      parseDiagramGroups(JSON.stringify(serializeDiagramGroups(groups)))
    ).toEqual(groups);
    const all = computeBoundaryBoxes(groups, saved);
    const visible = computeBoundaryBoxes(
      groups,
      saved.filter((node) => node.id === apiEast)
    );
    for (const box of visible)
      expect(box.color).toBe(
        all.find((candidate) => candidate.id === box.id)?.color
      );
    expect(all.find((box) => box.id === "aws")?.color).toBe("orange");
    expect(all.find((box) => box.id === "aws-us-east-1")?.color).toBe("orange");
    expect(
      groups.find((group) => group.id === "checkout-path")
    ).not.toHaveProperty("color");
  });
  it("keeps originals ungrouped and grouped variants on the same elements", () => {
    for (const pair of DIAGRAM_GROUP_FIXTURE_PAIRS) {
      expect(pair.original.groups).toEqual([]);
      expect(pair.grouped.elements).toEqual(pair.original.elements);
      expect(pair.grouped.flows).toEqual(pair.original.flows);
      expect(
        parseDiagramGroups(
          JSON.stringify(diagramGroupFixtureSection(pair.grouped))
        )
      ).toEqual(pair.grouped.groups);
    }
  });

  it("represents one canonical service as two placements in different regions", () => {
    const placements = deployment.grouped.elements.filter(
      (element) =>
        element.canonicalReference?.entityId === CHECKOUT_API_SERVICE_ID
    );
    expect(placements).toHaveLength(2);
    const boxes = computeBoundaryBoxes(deployment.grouped.groups, saved);
    expect(
      boxes.find((box) => box.id === "aws-us-east-1")?.memberNodeIds
    ).toContain(placements[0]!.id);
    expect(
      boxes.find((box) => box.id === "gcp-europe-west1")?.memberNodeIds
    ).toContain(placements[1]!.id);
  });

  it("draws nested boxes around saved positions without moving them", () => {
    const before = JSON.stringify(saved);
    const boxes = computeBoundaryBoxes(deployment.grouped.groups, saved);
    expect(JSON.stringify(saved)).toBe(before);
    const byId = new Map(boxes.map((box) => [box.id, box]));
    const region = byId.get("aws-us-east-1")!;
    const provider = byId.get("aws")!;
    expect(region).toMatchObject({
      x: 600 - DIAGRAM_BOUNDARY_PADDING,
      y: 0 - DIAGRAM_BOUNDARY_PADDING - DIAGRAM_BOUNDARY_LABEL_HEIGHT,
      width: 250 + size + DIAGRAM_BOUNDARY_PADDING * 2,
      depth: 1,
      parentGroupId: "aws",
      factual: true,
    });
    expect(provider.depth).toBe(0);
    expect(provider.x).toBeLessThan(region.x);
    expect(provider.y).toBeLessThan(region.y);
    expect(provider.x + provider.width).toBeGreaterThan(
      region.x + region.width
    );
    expect(byId.get("checkout-path")).toMatchObject({ factual: false });
    expect(boxes.map((box) => box.depth)).toEqual(
      [...boxes.map((box) => box.depth)].sort()
    );
  });

  it("is deterministic regardless of group or node order", () => {
    const forward = computeBoundaryBoxes(deployment.grouped.groups, saved);
    const reversed = computeBoundaryBoxes(
      [...deployment.grouped.groups].reverse(),
      [...saved].reverse()
    );
    expect(reversed).toEqual(forward);
  });

  it("marks non-members whose saved position falls inside a factual boundary", () => {
    const intruding = saved.map((rect) =>
      rect.id === payments ? { ...rect, x: 700, y: 10 } : rect
    );
    const region = computeBoundaryBoxes(
      deployment.grouped.groups,
      intruding
    ).find((box) => box.id === "aws-us-east-1")!;
    expect(region.intrudingNodeIds).toEqual([payments]);
    expect(
      computeBoundaryBoxes(deployment.grouped.groups, intruding).find(
        (box) => box.id === "checkout-path"
      )?.intrudingNodeIds
    ).toEqual([]);
  });

  it("resolves members against materialized and projected node ids", () => {
    const member = {
      kind: "persistedWorkItem" as const,
      workItemId: apiEast!,
    };
    expect(resolveDiagramGroupMemberNodeId(member, new Set([apiEast!]))).toBe(
      apiEast
    );
    expect(
      resolveDiagramGroupMemberNodeId(member, new Set([`existing:${apiEast}`]))
    ).toBe(`existing:${apiEast}`);
    expect(
      resolveDiagramGroupMemberNodeId(
        { kind: "temporaryWorkItem", temporaryRef: "api" },
        new Set(["temporary:api"])
      )
    ).toBe("temporary:api");
  });

  it("ignores old, empty and malformed sections", () => {
    expect(parseDiagramGroups(null)).toEqual([]);
    expect(parseDiagramGroups("not json")).toEqual([]);
    expect(parseDiagramGroups({ schemaVersion: "other", groups: [] })).toEqual(
      []
    );
    expect(computeBoundaryBoxes([], saved)).toEqual([]);
  });

  it("supplies mandatory containment and soft association to layout", () => {
    const hints = buildDiagramLayoutGroupHints(
      deployment.grouped.groups,
      new Set(saved.map((rect) => rect.id))
    )!;
    expect(hints.boundaryOf[apiEast!]).toBe("aws-us-east-1");
    expect(hints.boundaryOf[apiWest!]).toBe("gcp-europe-west1");
    expect(hints.boundaryOf[shopper!]).toBeUndefined();
    expect(
      hints.boundaries.find((boundary) => boundary.id === "aws-us-east-1")
    ).toEqual({ id: "aws-us-east-1", parentId: "aws" });
    expect(hints.associations).toEqual([
      { id: "checkout-path", nodeIds: [shopper, dns].sort() },
    ]);
    expect(
      buildDiagramLayoutGroupHints([], new Set(saved.map((rect) => rect.id)))
    ).toBeUndefined();
    expect(
      serializeDiagramGroups(deployment.grouped.groups).schemaVersion
    ).toBe("diagram-groups.v1");
  });
});
