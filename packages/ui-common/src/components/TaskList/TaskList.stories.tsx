import type { Meta, StoryObj } from "@storybook/react";
import {
  TaskPriority,
  TaskSource,
  WorkStatus,
  type TaskResponseDto,
} from "../../api";
import { TaskList, type TaskGridProps } from "./TaskList";

const STORY_ORGANIZATION_ID = "storybook-org";
const STORY_PROJECT_ID = "storybook-project";

const baseTask = (
  overrides: Partial<TaskResponseDto> & Pick<TaskResponseDto, "id" | "name">
): TaskResponseDto => ({
  type: "STANDARD",
  organizationId: STORY_ORGANIZATION_ID,
  projectId: STORY_PROJECT_ID,
  status: WorkStatus.Backlog,
  source: TaskSource.User,
  hasProposalSupport: true,
  ...overrides,
});

const populatedTasks: TaskResponseDto[] = [
  baseTask({
    id: "task-1",
    name: "Draft onboarding spec",
    status: WorkStatus.RefiningDescription,
    priority: TaskPriority.High,
  }),
  baseTask({
    id: "task-2",
    name: "Wire up activity dashboard query",
    status: WorkStatus.Backlog,
    priority: TaskPriority.Medium,
    childCounts: { total: 3, done: 1, inProgress: 1, backlog: 1 },
  }),
  baseTask({
    id: "task-3",
    name: "Fix mention badge regression",
    type: "BUG",
    status: WorkStatus.Backlog,
    priority: TaskPriority.Critical,
  }),
];

const meta: Meta<typeof TaskList> = {
  title: "Components/TaskList",
  component: TaskList,
};

export default meta;

type Story = StoryObj<typeof TaskList>;

const baseArgs: TaskGridProps = {
  tasks: [],
  projectId: STORY_PROJECT_ID,
};

export const Empty: Story = {
  args: {
    ...baseArgs,
    tasks: [],
    emptyMessage: "No tasks yet — create one to get started.",
    showCreateButton: true,
  },
};

export const Loading: Story = {
  args: {
    ...baseArgs,
    tasks: [],
    loading: true,
  },
};

export const Populated: Story = {
  args: {
    ...baseArgs,
    tasks: populatedTasks,
  },
};

export const PopulatedExpandable: Story = {
  args: {
    ...baseArgs,
    tasks: populatedTasks,
    expandable: true,
    organizationId: STORY_ORGANIZATION_ID,
  },
};
