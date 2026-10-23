export type { ApprovalConfig, PermissionRule, EntityContext } from "./types";
export { rules } from "./rules";
export { evaluatePermissions, matchesRule } from "./evaluate";
export type { ApprovalProgress } from "./approval";
export {
  getApprovalProgress,
  formatApprovalLabel,
  formatApprovalStatus,
} from "./approval";
