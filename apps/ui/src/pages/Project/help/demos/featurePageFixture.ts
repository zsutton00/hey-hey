import { WORK_ITEM_TYPE_KEYS } from "../../../../types/workItemTypes";
import {
  ProjectMaturity,
  ProjectRole,
  ProjectStatus,
  TaskSource,
  WorkStatus,
  type ProjectResponseDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import { type Stable } from "@hey-hey/ui-common";

import type {
  FeaturePageViewProps,
  FeaturePageActiveTab,
  FeaturePageTabChange,
} from "../../../Features/FeaturePageView";
import type { NewTaskFormData } from "../../../../components/Tasks";
import type { FeatureTaskListPagingState } from "../../../Features/FeaturePageView";

const DEMO_ORG_ID = "demo-org";
const DEMO_PROJECT_ID = "demo-project";
const DEMO_TASK_ID = "demo-feature-1";
const NOW = "2024-01-01T00:00:00.000Z";

const buildTypeDefinition = (
  key: string,
  name: string,
): WorkItemTypeDefinitionDto => ({
  key,
  name,
  role: key === WORK_ITEM_TYPE_KEYS.Feature ? "project-info" : "work-item",
  sections: [
    { key: "description", label: "Description" },
    { key: "acceptanceCriteria", label: "Acceptance Criteria" },
  ],
  allowedStatuses: [],
});

const featureTypeDefinition: WorkItemTypeDefinitionDto = {
  ...buildTypeDefinition(WORK_ITEM_TYPE_KEYS.Feature, "Feature"),
};
const featureTypeDefinitions = new Map(
  [
    featureTypeDefinition,
    buildTypeDefinition(WORK_ITEM_TYPE_KEYS.Standard, "Task"),
    buildTypeDefinition(WORK_ITEM_TYPE_KEYS.Bug, "Bug"),
    buildTypeDefinition("MARKETING", "Marketing"),
  ].map((definition) => [definition.key, definition]),
);

const syntheticFeature: TaskResponseDto = {
  id: DEMO_TASK_ID,
  name: "Authentication",
  type: WORK_ITEM_TYPE_KEYS.Feature,
  organizationId: DEMO_ORG_ID,
  projectId: DEMO_PROJECT_ID,
  status: WorkStatus.Active,
  source: TaskSource.System,
  createdAt: NOW,
  updatedAt: NOW,
  designDocCount: 1,
  codingSessionCount: 0,
  agentSessionCount: 0,
  childCounts: { total: 2, done: 0, inProgress: 1, backlog: 1 },
  sections: [
    {
      id: "demo-section-description",
      key: "description",
      order: 0,
      materializedMarkdown:
        "Sign up, sign in, password reset, and SSO integration. " +
        "The agent will draft tasks and you can refine the scope from here.",
      materializedProposalId: "demo-materialized-proposal",
    },
    {
      id: "demo-section-acceptance",
      key: "acceptanceCriteria",
      order: 1,
      materializedMarkdown:
        "- Users can create an account with email + password\n" +
        "- Users can sign in and out\n" +
        "- Password reset works end-to-end",
      materializedProposalId: "demo-materialized-proposal",
    },
  ],
};

/**
 * Synthetic child tasks for demos that flip `activeTab` to 'children'. The
 * shape mirrors `TaskResponseDto` so `TaskTab` / `TaskList` render a
 * non-empty list without reaching the network.
 */
export const SYNTHETIC_CHILD_TASKS: readonly TaskResponseDto[] = [
  {
    id: "demo-child-task-1",
    name: "Add a settings page",
    type: WORK_ITEM_TYPE_KEYS.Standard,
    organizationId: DEMO_ORG_ID,
    projectId: DEMO_PROJECT_ID,
    status: WorkStatus.Backlog,
    source: TaskSource.System,
    createdAt: NOW,
    updatedAt: NOW,
    designDocCount: 0,
    codingSessionCount: 0,
    agentSessionCount: 0,
    childCounts: { total: 0, done: 0, inProgress: 0, backlog: 0 },
    sections: [],
  },
  {
    id: "demo-child-task-2",
    name: "Wire up notification preference toggles",
    type: WORK_ITEM_TYPE_KEYS.Standard,
    organizationId: DEMO_ORG_ID,
    projectId: DEMO_PROJECT_ID,
    status: WorkStatus.Backlog,
    source: TaskSource.System,
    createdAt: NOW,
    updatedAt: NOW,
    designDocCount: 0,
    codingSessionCount: 0,
    agentSessionCount: 0,
    childCounts: { total: 0, done: 0, inProgress: 0, backlog: 0 },
    sections: [],
  },
];

const syntheticProject = (
  organizationId: string,
  projectId: string,
): ProjectResponseDto => ({
  id: projectId,
  name: "Demo Project",
  organizationId,
  status: ProjectStatus.Active,
  currentUserRole: ProjectRole.Owner,
  hasEstablishedActivity: true,
  maturity: ProjectMaturity.Established,
  createdAt: NOW,
  updatedAt: NOW,
});

const noopTabChange: FeaturePageTabChange = () => undefined;

const noopAsync = async (): Promise<void> => {
  /* demo no-op */
};

const noopVoid = (): void => {
  /* demo no-op */
};

// Module-level constants are guaranteed-stable references; cast is the
// documented escape hatch (see ui-common/src/types/stable.d.ts).
const stableNoop = noopVoid as Stable<() => void>;
const noopSetString = (_value: string): void => undefined;
const demoTaskListPaging: FeatureTaskListPagingState = {
  page: 1,
  sortKey: "createdAt:desc",
  setSortKey: noopSetString,
  search: "",
  setSearch: noopSetString,
  status: "",
  setStatus: noopSetString,
  getPaginationProps: () => ({
    count: 1,
    page: 1,
    onChange: () => undefined,
    visible: false,
  }),
};

/**
 * Build the fixture props for the demo's live `FeaturePageView` render.
 *
 * Pass a real `TaskResponseDto` (e.g. the project's first feature from
 * `useFeatures`) to make the scene reflect the user's actual project; pass
 * nothing to fall back to the synthetic Authentication feature.
 *
 * Only the feature itself is swapped in — surrounding props (project, design
 * docs, conversations, dialog state, callbacks) stay synthetic so the demo
 * never reaches the network.
 *
 * `overrides` lets a caller flip individual props for a specific scene
 * (e.g. switching `activeTab` to 'children'). Anything not overridden keeps
 * its default fixture value.
 */
export function buildFeaturePageFixture(
  realFeature?: TaskResponseDto,
  overrides?: Partial<FeaturePageViewProps>,
): FeaturePageViewProps {
  const task = realFeature ?? syntheticFeature;
  const organizationId = task.organizationId || DEMO_ORG_ID;
  const projectId = task.projectId || DEMO_PROJECT_ID;
  const taskId = task.id;

  const base: FeaturePageViewProps = {
    organizationId,
    projectId,
    taskId,

    task,
    featureAncestors: [],
    workItemTypeDefinition: featureTypeDefinition,
    workItemSectionSelection: {
      status: "resolved",
      typeKey: featureTypeDefinition.key,
      sections: featureTypeDefinition.sections,
    },
    activeWorkItemTypeDefinitions: featureTypeDefinitions,
    allowedChildTypes: ["FEATURE", "STANDARD"],
    children: [],
    taskListPaging: demoTaskListPaging,
    isChildrenLoading: false,
    featurePlans: [],
    isPlansLoading: false,
    project: syntheticProject(organizationId, projectId),
    relatedEntities: [],
    proposals: [],

    isPlatformAdmin: false,
    isRefining: false,

    isDiscussTasksOpen: false,
    discussTasksLoading: false,
    discussTasksError: null,
    onClearDiscussTasksError: noopVoid,
    onSubmitDiscussTasks: async (_submission): Promise<boolean> => {
      await noopAsync();
      return false;
    },
    onOpenDiscussTasks: noopVoid,
    onCloseDiscussTasks: noopVoid,

    relationshipEntityId: taskId,
    relationshipEntityType: "task",

    activeTab: "feature" satisfies FeaturePageActiveTab,
    activeType: null,
    isEditing: false,
    isTreeVisible: false,
    isTreeModalOpen: false,
    isNewTaskModalOpen: false,
    isNewFeatureModalOpen: false,
    confirmAction: null,
    isSubmittingAdminAction: false,
    isCreatingChildTask: false,
    isCreatingSubfeature: false,

    onEdit: stableNoop,
    onTabChange: noopTabChange,
    onTitleChange: async (_title: string): Promise<void> => {
      await noopAsync();
    },
    onToggleTree: noopVoid,
    onOpenTreeModal: noopVoid,
    onCloseTreeModal: noopVoid,
    onOpenNewTaskModal: noopVoid,
    onCloseNewTaskModal: noopVoid,
    onSubmitNewTask: async (_formData: NewTaskFormData): Promise<void> => {
      await noopAsync();
    },
    onOpenNewFeatureModal: noopVoid,
    onCloseNewFeatureModal: noopVoid,
    onCreateSubfeature: async (): Promise<void> => {
      await noopAsync();
    },
    onArchiveClick: noopVoid,
    onDeleteClick: noopVoid,
    onCancelAdminAction: noopVoid,
    onConfirmAdminAction: async (): Promise<void> => {
      await noopAsync();
    },
    onTagChanged: noopVoid,
  };

  return overrides ? { ...base, ...overrides } : base;
}
