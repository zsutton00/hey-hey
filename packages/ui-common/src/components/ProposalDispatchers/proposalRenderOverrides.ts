import { TargetEntityType } from "../../api";
import type { DiffViewMode } from "../SuggestedContent";
import type { ProposalRenderMode } from "./types";

/** Shared border treatment for plan-generation proposal cards and review fields. */
export const PLAN_PROPOSAL_BORDER = "2px solid #F57C00";

/**
 * Per-target-type rendering overrides applied by the CreateProposal /
 * UpdateProposal dispatchers. Renderers that don't yet honor a field
 * simply ignore it, so adding a new override is a no-op for unrelated
 * entity types.
 */
export interface ProposalRenderOverrides {
  /** Hide the entity-type Chip in the card header. */
  hideTypeChip?: boolean;
  /** Override the title font size (otherwise the renderer's default applies). */
  titleFontSize?: string;
  /** Cap the outer Paper width to this many pixels. */
  maxWidth?: number;
  /** Override the apply (approve) button label. */
  applyLabel?: string;
  /** Override the outer Paper border (e.g. plan-generation accent border). */
  border?: string;
  /** Omit the standalone Paper when this renderer is embedded in a member card. */
  hideCard?: boolean;
  /** Omit the standalone proposal header when this renderer is embedded. */
  hideHeader?: boolean;
  /** Omit standalone approval/rejection controls when the parent owns them. */
  hideStateIndicator?: boolean;
  /**
   * Show the evaluation-output badge in place of approve/reject/apply and
   * render from retained content. Display only; the server refuses approval.
   */
  evaluationOutput?: boolean;
}

const OVERRIDES: Partial<Record<TargetEntityType, ProposalRenderOverrides>> = {
  [TargetEntityType.WorkItemType]: {
    titleFontSize: "1.25rem",
    applyLabel: "Accept Type",
  },
};

const EMPTY_OVERRIDES: ProposalRenderOverrides = {};

export function getProposalRenderOverrides(
  targetEntityType: TargetEntityType,
  renderMode: ProposalRenderMode = "standalone",
): ProposalRenderOverrides {
  const overrides = OVERRIDES[targetEntityType] ?? EMPTY_OVERRIDES;
  switch (renderMode) {
    case "group-member":
      return {
        ...overrides,
        hideCard: true,
        hideHeader: true,
        hideStateIndicator: true,
      };
    case "reconciliation-refinement":
    case "future-review":
      return overrides;
    case "evaluation-output":
      return { ...overrides, evaluationOutput: true };
    case "standalone":
      return overrides;
  }
}

const DEFAULT_DIFF_VIEW_MODE_BY_TYPE_KEY: Record<string, DiffViewMode> = {
  MODE: "inline",
};

/**
 * Resolves the initial diff mode for an UPDATE proposal. A per-type presentation
 * requirement (Agent Modes => Inline) wins; otherwise the caller-level default
 * applies, falling back to Split as required by Inline Proposals.
 */
export function resolveDiffDefaultViewMode(
  workItemTypeKey: string | undefined,
  callerDefault?: DiffViewMode,
): DiffViewMode {
  return (
    (workItemTypeKey
      ? DEFAULT_DIFF_VIEW_MODE_BY_TYPE_KEY[workItemTypeKey]
      : undefined) ??
    callerDefault ??
    "split"
  );
}
