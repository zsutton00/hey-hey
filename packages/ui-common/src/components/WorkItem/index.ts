export { TagEditor } from "./TagEditor";
export { WorkItemEditor } from "./WorkItemEditor";
export type { WorkItemEditorProps } from "./WorkItemEditor";
export {
  WorkItemUnsavedChangesBridge,
  useRegisterWorkItemUnsavedChanges,
  useWorkItemUnsavedChanges,
} from "./WorkItemUnsavedChangesBridge";
export type { WorkItemUnsavedChangesAccess } from "./WorkItemUnsavedChangesBridge";
export { WorkItemFilters } from "./WorkItemFilters";
export { useFilteredWorkItems } from "./useFilteredWorkItems";
export { getWorkItemCounts } from "./utils";
export { WorkItemMetadata } from "./WorkItemMetadata";
export type {
  EditableMetadataField,
  MetadataField,
  ReadOnlyMetadataField,
  WorkItemMetadataFields,
  WorkItemMetadataProps,
} from "./WorkItemMetadata";
export { StatusActionCompact } from "./StatusActionCompact";
export type { StatusActionCompactProps } from "./StatusActionCompact";
export { SupersedeTaskDialog } from "./SupersedeTaskDialog";
export type { SupersedeTaskDialogProps } from "./SupersedeTaskDialog";

// Note: Service types are available from services/workItemService
// Import directly from there to avoid re-export conflicts
