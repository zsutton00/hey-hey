import { WORK_ITEM_TYPE_KEYS } from "../../../../types/workItemTypes";
import {
  type AgentSessionDto,
  ProjectMaturity,
  ProjectRole,
  ProjectStatus,
  TaskPriority,
  TaskSource,
  WorkStatus,
  type ProjectResponseDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import { type Stable } from "@hey-hey/ui-common";
import type { UseTaskGenerationCapsuleActionResult } from "@hey-hey/ui-common/components";

import type {
  TaskPageTabChange,
  TaskPageViewProps,
} from "../../../Task/TaskPageView";
import type { TaskScopedAgentSessionsTabViewProps } from "../../../../components/Tabs/TaskScopedAgentSessionsTabView";
import type { NewTaskFormData } from "../../../../components/Tasks";

const DEMO_ORG_ID = "demo-org";
const DEMO_PROJECT_ID = "demo-project";
const DEMO_INITIATIVE_ID = "demo-initiative";
const DEMO_TASK_ID = "demo-task-1";
const NOW = "2024-01-01T00:00:00.000Z";

const taskTypeDefinition: WorkItemTypeDefinitionDto = {
  key: WORK_ITEM_TYPE_KEYS.Standard,
  name: "Task",
  role: "work-item",
  sections: [
    { key: "description", label: "Description" },
    { key: "acceptanceCriteria", label: "Acceptance Criteria" },
  ],
  allowedStatuses: [],
  capabilities: {
    planEligible: true,
  },
};

const syntheticTask: TaskResponseDto = {
  id: DEMO_TASK_ID,
  name: "Add a settings page",
  type: WORK_ITEM_TYPE_KEYS.Standard,
  organizationId: DEMO_ORG_ID,
  projectId: DEMO_PROJECT_ID,
  status: WorkStatus.Active,
  priority: TaskPriority.Medium,
  source: TaskSource.System,
  createdAt: NOW,
  updatedAt: NOW,
  designDocCount: 0,
  codingSessionCount: 0,
  agentSessionCount: 0,
  childCounts: { total: 0, done: 0, inProgress: 0, backlog: 0 },
  sections: [
    {
      id: "demo-section-description",
      key: "description",
      order: 0,
      materializedMarkdown:
        "Add a settings page where the user can change their notification " +
        "preferences. Hand this off to a coding agent from the Agent Sessions tab.",
      materializedProposalId: "demo-materialized-proposal",
    },
    {
      id: "demo-section-acceptance",
      key: "acceptanceCriteria",
      order: 1,
      materializedMarkdown:
        "- A settings page exists\n" +
        "- Users can toggle notification preferences\n" +
        "- Preferences persist across sessions",
      materializedProposalId: "demo-materialized-proposal",
    },
  ],
};

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

const noopTabChange: TaskPageTabChange = () => undefined;

const noopAsync = async (): Promise<void> => {
  /* demo no-op */
};

const noopVoid = (): void => {
  /* demo no-op */
};

const stableNoop = noopVoid as Stable<() => void>;
const stableRenderNull = ((): null => null) as Stable<() => null>;

/**
 * Empty agent-session list used by the demo's Agent Sessions tab. The
 * Step 4 demo wants to highlight the "Start New Session" call-to-action,
 * which is most prominent when no sessions exist yet.
 */
const EMPTY_AGENT_SESSIONS: readonly AgentSessionDto[] = [];

const taskGenerationAction: UseTaskGenerationCapsuleActionResult = {
  behavior: "expand",
  actionId: "tasks-from-adr",
  label: "Tasks",
  title: "Task Generation",
  menuItems: [],
  renderContent: stableRenderNull,
  inProgress: false,
  resumable: false,
  expandable: false,
};

/**
 * Build the fixture props for the demo's live `TaskPageView` render.
 *
 * Pass a real `TaskResponseDto` (e.g. the project's first task) to make the
 * scene reflect the user's actual project; pass nothing to fall back to the
 * synthetic settings-page task. Only the task itself is swapped in —
 * surrounding props (project, callbacks, capsule actions, dialog state) stay
 * synthetic so the demo never reaches the network.
 *
 * `overrides` lets a caller flip individual props for a specific scene
 * (e.g. switching `activeTab` to 'agent-sessions' or supplying an
 * `agentSessionsTabBody`). Anything not overridden keeps its default fixture
 * value.
 */
export function buildTaskPageFixture(
  realTask?: TaskResponseDto,
  overrides?: Partial<TaskPageViewProps>,
): TaskPageViewProps {
  const task = realTask ?? syntheticTask;
  const organizationId = task.organizationId || DEMO_ORG_ID;
  const projectId = task.projectId || DEMO_PROJECT_ID;
  const taskId = task.id;

  const base: TaskPageViewProps = {
    organizationId,
    projectId,
    initiativeId: DEMO_INITIATIVE_ID,
    taskId,

    task,
    parent: null,
    children: [],
    project: syntheticProject(organizationId, projectId),
    taskWithServiceRelations: null,
    taskServiceIds: [],
    workItemTypeDefinition: taskTypeDefinition,
    workItemSectionSelection: {
      status: "resolved",
      typeKey: taskTypeDefinition.key,
      sections: taskTypeDefinition.sections,
    },
    workItemTypeDefinitions: new Map([
      [taskTypeDefinition.key, taskTypeDefinition],
    ]),
    activeWorkItemTypeDefinitions: new Map([
      [taskTypeDefinition.key, taskTypeDefinition],
    ]),

    isPlatformAdmin: false,
    isTaskLoading: false,
    isRefining: false,
    isUpdatingTaskServices: false,

    childTaskCount: undefined,
    codingSessionCount: undefined,
    agentSessionCount: undefined,

    taskGenerationAction,
    featureAncestors: [],
    relatedEntities: [],
    proposals: [],

    relationshipEntityId: taskId,
    relationshipEntityType: "task",

    conversationPathForId: () => "",

    allowedChildTypes: ["STANDARD"],

    activeTab: "task",
    activeType: null,
    isEditing: false,
    isNewTaskModalOpen: false,
    isCreatingChildTask: false,
    isDeleteDialogOpen: false,
    isDeletingTask: false,
    isTreeVisible: true,

    onEdit: stableNoop,
    onToggleTree: noopVoid,
    onTabChange: noopTabChange,
    onTitleChange: async (_title: string): Promise<void> => {
      await noopAsync();
    },
    onStatusChange: async (_status): Promise<void> => {
      await noopAsync();
    },
    onPriorityChange: async (_priority): Promise<void> => {
      await noopAsync();
    },
    onDueDateChange: async (_dueDate): Promise<void> => {
      await noopAsync();
    },
    onAssigneeChange: async (_assigneeId): Promise<void> => {
      await noopAsync();
    },
    onTaskServicesChange: async (_serviceIds): Promise<void> => {
      await noopAsync();
    },
    onOpenNewTaskModal: noopVoid,
    onCloseNewTaskModal: noopVoid,
    onSubmitNewTask: async (_formData: NewTaskFormData): Promise<void> => {
      await noopAsync();
    },
    onDeleteClick: noopVoid,
    onCancelDelete: noopVoid,
    onConfirmDelete: async (): Promise<void> => {
      await noopAsync();
    },
  };

  return overrides ? { ...base, ...overrides } : base;
}

/**
 * Build presentational props for `TaskScopedAgentSessionsTabView` in the demo's
 * Agent Sessions scene. Defaults yield an empty session list so the
 * "Start New Session" button is the prominent target for the cursor click.
 */
export function buildTaskAgentSessionsTabViewProps(
  organizationId: string,
  projectId: string,
  taskId: string,
  overrides?: Partial<TaskScopedAgentSessionsTabViewProps>,
): TaskScopedAgentSessionsTabViewProps {
  const base: TaskScopedAgentSessionsTabViewProps = {
    organizationId,
    projectId,
    taskId,

    sessions: [...EMPTY_AGENT_SESSIONS],
    isLoading: false,
    emptyMessage: "No coding sessions found for this task yet.",

    searchTerm: "",
    onSearchTermChange: noopVoid,
    sortBy: "created-desc",
    onSortByChange: noopVoid,

    enableFilters: false,

    isCreatingNew: false,
    isUpdatingTaskStatus: false,
    unfinishedDependencies: [],
    isBacklogDialogOpen: false,
    error: null,
    onStartNewSession: noopVoid,
    onContinueDependencyWarning: noopVoid,
    onCancelDependencyWarning: noopVoid,
    onConfirmBacklogDialog: noopVoid,
    onCancelBacklogDialog: noopVoid,

    buildSessionPath: () => "",
    onDeleteSession: () => async () => {
      await noopAsync();
    },
  };

  return overrides ? { ...base, ...overrides } : base;
}
