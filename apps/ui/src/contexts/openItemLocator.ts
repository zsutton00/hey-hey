import {
  createEntityActivation,
  type EntityActivation,
  type OpenItemLocateRequest,
  type OpenItemLocator,
} from "@hey-hey/ui-common/context";
import type { OpenItemsContextValue } from "./openItemsContextValue";
import {
  matchesOpenItemIdentity,
  openItemKey,
  type OpenItem,
} from "./openItemsModel";
const menuActivation = ({
  entity,
  label,
  taskType,
}: OpenItemLocateRequest): EntityActivation => {
  switch (entity.entityType) {
    case "task":
      if (!taskType)
        throw new Error("Show in open items requires a task subtype");
      return createEntityActivation("task", entity.entityId, null, {
        kind: "task",
        label,
        taskType,
      });
    case "agent_session":
      // The shared menu carries no session type, which an agent-session
      // snapshot requires; surface the gap rather than store a wrong snapshot.
      throw new Error(
        "Show in open items cannot add an agent session that is not already open",
      );
    default:
      return {
        ...entity,
        lineage: null,
        presentation: { kind: entity.entityType, label },
      } as EntityActivation;
  }
};

export const createOpenItemLocator = (
  items: readonly OpenItem[],
  activate: OpenItemsContextValue["activate"],
): OpenItemLocator => ({
  showInOpenItems: (request) => {
    const held = items.find((item) =>
      matchesOpenItemIdentity(item, request.entity),
    );
    if (!held) {
      // Only absent entries are activated: a null-lineage activation would
      // overwrite a held entry's stored lineage.
      void activate(menuActivation(request));
      return;
    }
    document
      .querySelector(
        `[data-open-item-key="${CSS.escape(openItemKey(held))}"]`,
      )
      ?.scrollIntoView({ block: "nearest" });
  },
});
