import type { FilterConfig } from "./EntityFilters";
import { WorkStatus, Priority } from "../../api";

/**
 * Filter configuration for work items (Tasks and Initiatives)
 */
export const WORK_ITEM_FILTERS: FilterConfig[] = [
  {
    type: "search",
    key: "search",
    label: "Search",
    placeholder: "Search by name or tags",
  },
  {
    type: "select",
    key: "status",
    label: "Status",
    options: [
      { value: WorkStatus.Generated, label: "Generated" },
      { value: WorkStatus.Backlog, label: "Backlog" },
      { value: WorkStatus.Refining, label: "Refining" },
      { value: WorkStatus.RefiningDescription, label: "Refining Description" },
      { value: WorkStatus.RefiningDetails, label: "Refining Details" },
      {
        value: WorkStatus.RefiningAcceptanceCriteria,
        label: "Refining Acceptance Criteria",
      },
      { value: WorkStatus.Active, label: "Active" },
      { value: WorkStatus.Verifying, label: "Veriying" },
      { value: WorkStatus.OnHold, label: "On Hold" },
      { value: WorkStatus.Blocked, label: "Blocked" },
      { value: WorkStatus.Completed, label: "Completed" },
      { value: WorkStatus.Cancelled, label: "Cancelled" },
    ],
  },
  {
    type: "select",
    key: "priority",
    label: "Priority",
    options: [
      { value: Priority.Critical, label: "Critical" },
      { value: Priority.High, label: "High" },
      { value: Priority.Medium, label: "Medium" },
      { value: Priority.Low, label: "Low" },
    ],
  },
];

/**
 * Filter configuration for tasks (extends work item filters)
 */
export const TASK_FILTERS: FilterConfig[] = [
  ...WORK_ITEM_FILTERS,
  {
    type: "select",
    key: "assignee",
    label: "Assignee",
    options: [], // Populated dynamically from users
  },
];

/**
 * Filter configuration for initiatives
 */
export const INITIATIVE_FILTERS: FilterConfig[] = [
  ...WORK_ITEM_FILTERS,
  {
    type: "select",
    key: "assignee",
    label: "Assignee",
    options: [], // Populated dynamically from users
  },
];

/**
 * Filter configuration for coding sessions
 */
export const AGENT_SESSION_FILTERS: FilterConfig[] = [
  {
    type: "search",
    key: "search",
    label: "Search",
    placeholder: "Search sessions",
  },
  {
    type: "select",
    key: "userId",
    label: "User",
    options: [], // Populated dynamically from users
  },
];

/**
 * Filter configuration for design documents
 */
export const DESIGN_DOC_FILTERS: FilterConfig[] = [
  {
    type: "search",
    key: "search",
    label: "Search",
    placeholder: "Search design docs",
  },
  {
    type: "select",
    key: "status",
    label: "Status",
    options: [], // Populated dynamically based on template
  },
  {
    type: "multiselect",
    key: "tags",
    label: "Tags",
    options: [], // Populated dynamically from available tags
  },
];

/**
 * Filter configuration for services
 */
export const SERVICE_FILTERS: FilterConfig[] = [
  {
    type: "search",
    key: "search",
    label: "Search",
    placeholder: "Search services",
  },
  {
    type: "select",
    key: "status",
    label: "Status",
    options: [
      { value: "ACTIVE", label: "Active" },
      { value: "ARCHIVED", label: "Archived" },
      { value: "DEPRECATED", label: "Deprecated" },
    ],
  },
  {
    type: "select",
    key: "serviceType",
    label: "Type",
    options: [
      { value: "backend", label: "Backend" },
      { value: "ui", label: "UI" },
      { value: "database", label: "Database" },
      { value: "worker", label: "Worker" },
      { value: "mobile", label: "Mobile" },
      { value: "desktop", label: "Desktop" },
      { value: "library", label: "Library" },
      { value: "other", label: "Other" },
    ],
  },
  {
    type: "multiselect",
    key: "tags",
    label: "Tags",
    options: [], // Populated dynamically from available tags
  },
];

/**
 * Sort options for work items (Tasks and Initiatives)
 */
export const WORK_ITEM_SORT_OPTIONS = [
  { value: "created-desc", label: "Newest first" },
  { value: "created-asc", label: "Oldest first" },
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
];

/**
 * Sort options for coding sessions
 */
export const AGENT_SESSION_SORT_OPTIONS = [
  { value: "session-date-desc", label: "Newest first" },
  { value: "session-date-asc", label: "Oldest first" },
  { value: "title-asc", label: "Title (A-Z)" },
  { value: "title-desc", label: "Title (Z-A)" },
];

/**
 * Sort options for design documents
 */
export const DESIGN_DOC_SORT_OPTIONS = [
  { value: "created-desc", label: "Newest first" },
  { value: "created-asc", label: "Oldest first" },
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "status", label: "Status" },
];

/**
 * Sort options for services
 */
export const SERVICE_SORT_OPTIONS = [
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "created-desc", label: "Newest first" },
  { value: "created-asc", label: "Oldest first" },
  { value: "status", label: "Status" },
];
