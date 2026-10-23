export type EditType = "create" | "modify" | "delete";

export const EDIT_TYPE_COLORS: Record<
  EditType,
  "success.main" | "warning.main" | "error.main"
> = {
  create: "success.main",
  modify: "warning.main",
  delete: "error.main",
};

export const EDIT_TYPE_LABELS: Record<EditType, string> = {
  create: "Created",
  modify: "Modified",
  delete: "Deleted",
};
