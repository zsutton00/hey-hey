import type { AgentEdgeResponseDto, WorkflowTransitionRole } from "../../api";
import { placeJourneyScreens } from "./placeJourneyScreens";

interface FlowScreen {
  id: string;
  name: string;
}

type FlowTransition = Pick<
  AgentEdgeResponseDto,
  | "id"
  | "sourceNodeId"
  | "targetNodeId"
  | "actionLabel"
  | "predicate"
  | "transitionRole"
>;

export interface UxFlowShape {
  steps: readonly FlowScreen[];
  edges: readonly FlowTransition[];
}

/** One outgoing transition of a screen: the action that triggers it and where it leads. */
export interface ScreenNextOption {
  edgeId: string;
  actionLabel: string | null;
  targetStepId: string;
  targetName: string;
  role: WorkflowTransitionRole | null;
}

export interface ScreenNextOptionGroup {
  /** Null groups the transitions that record no role. */
  role: WorkflowTransitionRole | null;
  title: string;
  options: ScreenNextOption[];
}

/** Fixed display order; roles are recorded on the transition and never inferred. */
const GROUP_ORDER: readonly {
  role: WorkflowTransitionRole | null;
  title: string;
}[] = [
  { role: "PRIMARY_PROGRESSION", title: "Main path" },
  { role: "ERROR_PATH", title: "Error path" },
  { role: "RECOVERY", title: "Recovery" },
  { role: "RETURN", title: "Return" },
  { role: null, title: "Other options" },
];

/** Every outgoing transition of a screen, in the flow's own order. */
export function deriveScreenNextOptions(
  flow: UxFlowShape,
  screenStepId: string,
): ScreenNextOption[] {
  const names = new Map(flow.steps.map((step) => [step.id, step.name]));

  return flow.edges.flatMap((edge) => {
    const targetName = names.get(edge.targetNodeId);
    if (edge.sourceNodeId !== screenStepId || targetName === undefined) {
      return [];
    }

    return [
      {
        edgeId: edge.id,
        actionLabel: edge.actionLabel ?? edge.predicate ?? null,
        targetStepId: edge.targetNodeId,
        targetName,
        role: edge.transitionRole ?? null,
      },
    ];
  });
}

/** Options grouped by recorded role in a fixed order; empty groups are left out. */
export function groupScreenNextOptions(
  options: readonly ScreenNextOption[],
): ScreenNextOptionGroup[] {
  return GROUP_ORDER.map(({ role, title }) => ({
    role,
    title,
    options: options.filter((option) => option.role === role),
  })).filter((group) => group.options.length > 0);
}

/** Screens in the order the grid places them: left to right, top to bottom. */
export function orderFlowScreenIds(
  flow: UxFlowShape,
  savedPositions: ReadonlyMap<string, { x: number; y: number }>,
): string[] {
  const ids = flow.steps.map((step) => step.id);
  const cells = placeJourneyScreens(
    ids,
    flow.edges.map((edge) => ({
      sourceId: edge.sourceNodeId,
      targetId: edge.targetNodeId,
    })),
    savedPositions,
  );
  const position = (id: string) => cells.get(id);

  return [...ids].sort((left, right) => {
    const a = position(left);
    const b = position(right);
    if (!a || !b) {
      return Number(!a) - Number(!b);
    }

    return a.column - b.column || a.row - b.row;
  });
}

/** The screens a person has visited, current last; back returns to the one before. */
export type WalkthroughTrail = readonly string[];

export function goToScreen(
  trail: WalkthroughTrail,
  screenId: string,
): WalkthroughTrail {
  return trail[trail.length - 1] === screenId ? trail : [...trail, screenId];
}

/** The screen the person came from, or null at the start. */
export function deriveIncomingScreen(trail: WalkthroughTrail): string | null {
  return trail.length > 1 ? trail[trail.length - 2] : null;
}

export function goBack(trail: WalkthroughTrail): WalkthroughTrail {
  return trail.length > 1 ? trail.slice(0, -1) : trail;
}
