/**
 * Type definitions for ui-common
 */

export type { SvgIconComponent } from "@mui/icons-material";

export type { Stable } from "./stable";
export type { WorkflowAboutType } from "./workflowAboutType";
export {
  NAVIGATION_LINEAGE_ENTITY_TYPES,
  createNavigationLineageEntry,
  navigationLineagesEqual,
} from "./userTracking";
export type {
  NavigationLineage,
  NavigationLineageEntityId,
  NavigationLineageEntityType,
  NavigationLineageEntry,
} from "./userTracking";
export {
  OPEN_ITEM_ENTITY_TYPES,
  createOpenItemEntity,
  isOpenItemEntityType,
} from "./openItems";
export type {
  OpenItemEntity,
  OpenItemEntityId,
  OpenItemEntityType,
} from "./openItems";
