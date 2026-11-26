import isEqual from "lodash/isEqual.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkItemGraphAggregateResponseDto } from "../../../api";
import { useDiagramElementReferences } from "../../../data/hooks/useDiagramElementReferences";
import { extractErrorMessage } from "../../../utils/errorUtils";
import { fitsDiagramCloseup } from "../../shared/diagramCloseupFraming";
import {
  type DiagramRect,
  unionDiagramRects,
} from "../../shared/diagramDrawingBounds";
import {
  isScreenFlow,
  resolveDiagramCloseupRects,
  type WorkflowGraphSurfaceData,
} from "../../shared/WorkflowMentionInlineRenderer";

/** One close-up: a Diagram and the elements it highlights. */
export interface WalkthroughPreview {
  graphData: WorkflowGraphSurfaceData;
  elementIds: string[];
}

/** Element positions of a Diagram, or null when it could not be arranged. */
type ElementRects = ReadonlyMap<string, DiagramRect> | null;

const toSurfaceData = (
  graph: WorkItemGraphAggregateResponseDto,
): WorkflowGraphSurfaceData => ({
  workflow: graph.root,
  steps: graph.children.filter(
    (child) => child.type.toUpperCase() === "DIAGRAM_ELEMENT",
  ),
  edges: graph.relationships,
  participation: graph.participation,
  layout: graph.layout,
});

/**
 * Positions of the Diagrams where elements may share a close-up. Sizes measured
 * from a drawn screen flow replace the ones assumed before it was drawn.
 */
function useElementRects(sharing: readonly WalkthroughPreview[]) {
  const [rectsByDiagram, setRectsByDiagram] = useState<
    ReadonlyMap<string, ElementRects>
  >(() => new Map());
  const [measuredByDiagram, setMeasuredByDiagram] = useState<
    ReadonlyMap<string, ElementRects>
  >(() => new Map());
  const handleMeasure = useCallback(
    (diagramId: string, rects: ReadonlyMap<string, DiagramRect>) => {
      setMeasuredByDiagram((current) =>
        isEqual(current.get(diagramId), rects)
          ? current
          : new Map(current).set(diagramId, rects),
      );
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    const store = (diagramId: string, rects: ElementRects) => {
      if (!disposed) {
        setRectsByDiagram((current) => new Map(current).set(diagramId, rects));
      }
    };
    sharing.forEach(({ graphData }) => {
      const diagramId = graphData.workflow.id;
      void resolveDiagramCloseupRects(graphData).then(
        (rects) => store(diagramId, rects),
        (error: unknown) => {
          console.warn(
            `Diagram ${diagramId} could not be arranged, so its elements are previewed separately: ${extractErrorMessage(error) ?? String(error)}`,
          );
          store(diagramId, null);
        },
      );
    });

    return () => {
      disposed = true;
    };
  }, [sharing]);

  return { rectsByDiagram, measuredByDiagram, handleMeasure };
}

const fitsTogether = (
  rects: ElementRects,
  elementIds: readonly string[],
  width: number,
): boolean => {
  const found = elementIds.flatMap((id) => rects?.get(id) ?? []);
  const region = unionDiagramRects(found);
  return (
    found.length === elementIds.length &&
    region !== undefined &&
    fitsDiagramCloseup(region, width)
  );
};

/**
 * The close-ups of one block of walkthrough parts, in report order: one per Diagram when
 * its linked elements fit in it together, otherwise one per element. The screen
 * flows in `screenFlows` must be measured and reported to `handleMeasure`.
 */
export function useWalkthroughPreviews(
  organizationId: string,
  projectId: string,
  elementIds: readonly string[],
  width: number,
) {
  const { isLoading, references } = useDiagramElementReferences(
    organizationId,
    projectId,
    elementIds,
  );
  const byDiagram = useMemo(() => {
    const groups = new Map<string, WalkthroughPreview>();
    references.forEach(({ elementId, graph }) => {
      const group = groups.get(graph.root.id) ?? {
        graphData: toSurfaceData(graph),
        elementIds: [],
      };
      group.elementIds.push(elementId);
      groups.set(graph.root.id, group);
    });
    return [...groups.values()];
  }, [references]);
  const sharing = useMemo(
    () => byDiagram.filter((group) => group.elementIds.length > 1),
    [byDiagram],
  );
  const screenFlows = useMemo(
    () => sharing.map(({ graphData }) => graphData).filter(isScreenFlow),
    [sharing],
  );
  const { rectsByDiagram, measuredByDiagram, handleMeasure } =
    useElementRects(sharing);
  const isArranging = sharing.some(
    ({ graphData }) =>
      width === 0 || !rectsByDiagram.has(graphData.workflow.id),
  );
  const previews = useMemo(
    () =>
      byDiagram.flatMap((group) => {
        const diagramId = group.graphData.workflow.id;
        const rects =
          measuredByDiagram.get(diagramId) ??
          rectsByDiagram.get(diagramId) ??
          null;
        return group.elementIds.length === 1 ||
          fitsTogether(rects, group.elementIds, width)
          ? [group]
          : group.elementIds.map((id) => ({
              graphData: group.graphData,
              elementIds: [id],
            }));
      }),
    [byDiagram, measuredByDiagram, rectsByDiagram, width],
  );
  const isPending = isLoading || isArranging;

  return {
    isLoading: isPending,
    previews: isPending ? [] : previews,
    screenFlows,
    handleMeasure,
  };
}
