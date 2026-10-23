import { ProposalAction, TargetEntityType } from "../../api";
import type { ProposalResponseDto } from "../../api";

/**
 * Per-(action, targetEntityType) opt-in for the stepper layout. A pair only
 * gets stacked when consecutive proposals of that pair appear ≥ minGroupSize
 * times in a single CreateProposal/UpdateProposal payload. Anything not in
 * this map continues to render as a stack of standalone cards.
 */
export interface StepperConfigEntry {
  minGroupSize: number;
}

const STEPPER_CONFIG: ReadonlyArray<{
  action: ProposalAction;
  targetEntityType: TargetEntityType;
  config: StepperConfigEntry;
}> = [];

export function getStepperConfig(
  action: ProposalAction,
  targetEntityType: TargetEntityType,
): StepperConfigEntry | null {
  const found = STEPPER_CONFIG.find(
    (entry) =>
      entry.action === action && entry.targetEntityType === targetEntityType,
  );
  return found?.config ?? null;
}

export type ProposalRenderUnit =
  | { kind: "single"; proposal: ProposalResponseDto }
  | {
      kind: "group";
      action: ProposalAction;
      targetEntityType: TargetEntityType;
      proposals: ProposalResponseDto[];
    };

/**
 * Bucket proposals into ordered render units. Consecutive proposals sharing
 * the same (action, targetEntityType) are emitted as a `group` when the run
 * is opted in via `STEPPER_CONFIG` and meets that pair's `minGroupSize`.
 * Everything else falls through as `single` units, preserving input order.
 */
export function groupProposals(
  proposals: ReadonlyArray<ProposalResponseDto>,
): ProposalRenderUnit[] {
  const units: ProposalRenderUnit[] = [];
  let i = 0;
  while (i < proposals.length) {
    const head = proposals[i];
    const config = getStepperConfig(head.action, head.targetEntityType);
    if (!config) {
      units.push({ kind: "single", proposal: head });
      i += 1;
      continue;
    }

    let j = i + 1;
    while (
      j < proposals.length &&
      proposals[j].action === head.action &&
      proposals[j].targetEntityType === head.targetEntityType
    ) {
      j += 1;
    }

    const run = proposals.slice(i, j);
    if (run.length >= config.minGroupSize) {
      units.push({
        kind: "group",
        action: head.action,
        targetEntityType: head.targetEntityType,
        proposals: run,
      });
    } else {
      for (const p of run) {
        units.push({ kind: "single", proposal: p });
      }
    }
    i = j;
  }
  return units;
}
