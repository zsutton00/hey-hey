import {
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  type WorkItemTypeSummaryDto,
} from "@hey-hey/ui-common/api";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";

export function selectProjectEvalType(
  summaries: readonly WorkItemTypeSummaryDto[],
  projectId: string,
  isReady: boolean,
): WorkItemTypeSummaryDto | undefined {
  if (!isReady) return undefined;
  return summaries.find(
    (summary) =>
      summary.projectId === projectId &&
      summary.status === WorkItemTypeLifecycleStatus.Active &&
      summary.definition.key === WORK_ITEM_TYPE_KEYS.Eval &&
      summary.definition.role === WorkItemTypeRole.Monitor,
  );
}
