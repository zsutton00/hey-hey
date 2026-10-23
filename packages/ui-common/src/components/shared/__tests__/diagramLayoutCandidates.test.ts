import { describe, expect, it } from "vitest";
import {
  computeDiagramLayoutCandidate,
  type DiagramLayoutInput,
} from "../diagramLayoutCandidates";
import {
  DIAGRAM_GROUP_FIXTURE_NODE_SIZE,
  DIAGRAM_GROUP_FIXTURE_PAIRS,
  diagramGroupFixtureLayoutInput,
} from "../__fixtures__/diagramGroupFixtures";

const graph: DiagramLayoutInput = {
  nodes: ["Start", "Decision", "Accept", "Retry", "Isolated"].map(
    (title, index) => ({
      id: `original-${index}`,
      title,
      width: 140,
      height: 140,
    }),
  ),
  edges: [
    { source: "original-0", target: "original-1", label: "" },
    { source: "original-1", target: "original-2", label: "Accepted" },
    { source: "original-1", target: "original-3", label: "Try again" },
    { source: "original-3", target: "original-1", label: "Return" },
    { source: "original-3", target: "original-3", label: "Loop" },
  ],
};

describe("diagram layout candidates", () => {
  it.each(["dagre", "elk-layered", "elk-stress"] as const)(
    "%s lays out branches, cycles, loops and disconnected nodes without mutating input",
    async (candidate) => {
      const before = JSON.stringify(graph);
      const result = await computeDiagramLayoutCandidate(
        graph,
        candidate,
        "RIGHT",
      );
      expect([...result.keys()].sort()).toEqual(
        graph.nodes.map((node) => node.id).sort(),
      );
      for (const position of result.values()) {
        expect(Number.isFinite(position.x)).toBe(true);
        expect(Number.isFinite(position.y)).toBe(true);
      }
      expect(JSON.stringify(graph)).toBe(before);
      expect(
        await computeDiagramLayoutCandidate(graph, candidate, "RIGHT"),
      ).toEqual(result);
      const renamed: DiagramLayoutInput = {
        nodes: [...graph.nodes]
          .reverse()
          .map((node) => ({ ...node, id: `temporary:${node.title}` })),
        edges: [...graph.edges].reverse().map((edge) => ({
          ...edge,
          source: `temporary:${
            graph.nodes.find((node) => node.id === edge.source)!.title
          }`,
          target: `temporary:${
            graph.nodes.find((node) => node.id === edge.target)!.title
          }`,
        })),
      };
      const permuted = await computeDiagramLayoutCandidate(
        renamed,
        candidate,
        "RIGHT",
      );
      for (const node of graph.nodes) {
        expect(permuted.get(`temporary:${node.title}`)).toEqual(
          result.get(node.id),
        );
      }
    },
  );

  it.each(["dagre", "elk-layered"] as const)(
    "%s honors horizontal and vertical progression",
    async (candidate) => {
      const line: DiagramLayoutInput = {
        nodes: graph.nodes.slice(0, 3),
        edges: graph.edges.slice(0, 2),
      };
      const horizontal = await computeDiagramLayoutCandidate(
        line,
        candidate,
        "RIGHT",
      );
      const vertical = await computeDiagramLayoutCandidate(
        line,
        candidate,
        "DOWN",
      );
      expect(horizontal.get("original-2")!.x).toBeGreaterThan(
        horizontal.get("original-0")!.x + 280,
      );
      expect(vertical.get("original-2")!.y).toBeGreaterThan(
        vertical.get("original-0")!.y + 280,
      );
    },
  );
});

describe("grouped diagram layout candidates", () => {
  const candidates = ["dagre", "elk-layered", "elk-stress"] as const;
  const size = DIAGRAM_GROUP_FIXTURE_NODE_SIZE;
  type Box = { left: number; top: number; right: number; bottom: number };
  const bounds = (
    positions: ReadonlyMap<string, { x: number; y: number }>,
    ids: readonly string[],
  ): Box => ({
    left: Math.min(...ids.map((id) => positions.get(id)!.x)),
    top: Math.min(...ids.map((id) => positions.get(id)!.y)),
    right: Math.max(...ids.map((id) => positions.get(id)!.x + size)),
    bottom: Math.max(...ids.map((id) => positions.get(id)!.y + size)),
  });
  const overlaps = (a: Box, b: Box) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const deployment = DIAGRAM_GROUP_FIXTURE_PAIRS.find(
    (pair) => pair.key === "aws-gcp-deployment",
  )!;

  it.each(candidates)(
    "%s lays out ungrouped originals exactly as before",
    async (candidate) => {
      for (const pair of DIAGRAM_GROUP_FIXTURE_PAIRS) {
        const input = diagramGroupFixtureLayoutInput(pair.original);
        expect(input.groups).toBeUndefined();
        const withoutKey = await computeDiagramLayoutCandidate(
          { nodes: input.nodes, edges: input.edges },
          candidate,
          "RIGHT",
        );
        expect(
          await computeDiagramLayoutCandidate(input, candidate, "RIGHT"),
        ).toEqual(withoutKey);
      }
    },
  );

  it.each(candidates)(
    "%s keeps every region's members together and outsiders out",
    async (candidate) => {
      const input = diagramGroupFixtureLayoutInput(deployment.grouped);
      const positions = await computeDiagramLayoutCandidate(
        input,
        candidate,
        "RIGHT",
      );
      expect(
        await computeDiagramLayoutCandidate(input, candidate, "RIGHT"),
      ).toEqual(positions);
      const regions = ["aws-us-east-1", "gcp-europe-west1"].map((region) =>
        Object.entries(input.groups!.boundaryOf)
          .filter(([, boundary]) => boundary === region)
          .map(([nodeId]) => nodeId),
      );
      const [east, west] = regions.map((ids) => bounds(positions, ids));
      // Factual containment: the two regions never interleave, and no
      // element outside a region sits inside its members' extent.
      expect(overlaps(east!, west!)).toBe(false);
      const members = new Set(regions.flat());
      for (const node of input.nodes.filter((node) => !members.has(node.id))) {
        const own = bounds(positions, [node.id]);
        expect(overlaps(own, east!)).toBe(false);
        expect(overlaps(own, west!)).toBe(false);
      }
    },
  );

  it.each(candidates)(
    "%s accepts association-only process groups",
    async (candidate) => {
      const pair = DIAGRAM_GROUP_FIXTURE_PAIRS.find(
        (candidatePair) => candidatePair.key === "process-association",
      )!;
      const input = diagramGroupFixtureLayoutInput(pair.grouped);
      expect(input.groups?.associations).toHaveLength(2);
      const positions = await computeDiagramLayoutCandidate(
        input,
        candidate,
        "RIGHT",
      );
      expect([...positions.keys()].sort()).toEqual(
        input.nodes.map((node) => node.id).sort(),
      );
    },
  );
});
