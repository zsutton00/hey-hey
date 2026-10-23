import FlagIcon from "@mui/icons-material/Flag";
import FolderIcon from "@mui/icons-material/Folder";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import ScienceIcon from "@mui/icons-material/Science";
import CodeIcon from "@mui/icons-material/Code";
import StorageIcon from "@mui/icons-material/Storage";
import LinkIcon from "@mui/icons-material/Link";
import PeopleIcon from "@mui/icons-material/People";
import ChatIcon from "@mui/icons-material/Chat";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import TimerIcon from "@mui/icons-material/Timer";
import BarChartIcon from "@mui/icons-material/BarChart";
import ShieldIcon from "@mui/icons-material/Shield";
import type { ComponentType } from "react";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import BugReportIcon from "@mui/icons-material/BugReport";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import SearchIcon from "@mui/icons-material/Search";
import SettingsIcon from "@mui/icons-material/Settings";
import StarIcon from "@mui/icons-material/Star";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { SvgIconProps } from "@mui/material";
import type {
  WorkItemIconKey,
  WorkItemColorKey,
  WorkItemTypeEffectiveSource,
  WorkItemStructuredMockupIconKey,
  WorkItemTypeDefinitionDto,
} from "../api";
import { AgentSessionIcon } from "./icons/AgentSession";
import { ContractIcon } from "./icons/Contract";
import { ConversationIcon } from "./icons/Conversation";
import { DecisionIcon } from "./icons/Decision";
import { DesignIcon } from "./icons/Design";
import { DesignDocIcon } from "./icons/DesignDoc";
import { IntegrationIcon } from "./icons/Integration";
import { InitiativeIcon } from "./icons/Initiative";
import { MessageIcon } from "./icons/Message";
import { MockupsIcon } from "./icons/Mockups";
import { PlanIcon } from "./icons/Plan";
import { ProjectIcon } from "./icons/Project";
import { ProposalIcon } from "./icons/Proposal";
import { ServiceIcon } from "./icons/Service";
import { TaskIcon } from "./icons/Task";
import { TaskMonitorIcon } from "./icons/TaskMonitor";
import { FeatureIcon } from "./icons/Feature";
import { GoalIcon } from "./icons/Goal";
import { ReportIcon } from "./icons/Report";
import { UserIcon } from "./icons/User";

export interface EntityColors {
  background: string;
  color: string;
}

export interface WorkItemIconIdentity {
  typeKey: string;
  definition: WorkItemTypeDefinitionDto | undefined;
  effectiveSource?: WorkItemTypeEffectiveSource;
}

const entityIconMap = {
  task: TaskIcon,
  task_monitor: TaskMonitorIcon,
  standard: TaskIcon,
  bug: BugReportIcon,
  contract: ContractIcon,
  mockup: DesignIcon,
  decision: DecisionIcon,
  workflow: AccountTreeIcon,
  workflowstep: AccountTreeIcon,
  feature: FeatureIcon,
  goal: GoalIcon,
  initiative: InitiativeIcon,
  design_doc: DesignDocIcon,
  agent_session: AgentSessionIcon,
  service: ServiceIcon,
  message: MessageIcon,
  mockups: MockupsIcon,
  integration: IntegrationIcon,
  conversation: ConversationIcon,
  project: ProjectIcon,
  plan: PlanIcon,
  report: ReportIcon,
  proposal: ProposalIcon,
  user: UserIcon,
} as const;

/**
 * Explicit shared icon selections. This presentation palette is intentionally
 * separate from the registry-owned WorkItemIconKey palette.
 */
export type EntityIconKey = keyof typeof entityIconMap;

const workItemIconMap = {
  task: TaskIcon,
  bug: BugReportIcon,
  feature: FeatureIcon,
  goal: GoalIcon,
  contract: ContractIcon,
  design: DesignIcon,
  decision: DecisionIcon,
  workflow: AccountTreeIcon,
  plan: PlanIcon,
  "plan-stage": AccountTreeIcon,
  star: StarIcon,
  flag: FlagIcon,
  folder: FolderIcon,
  book: MenuBookIcon,
  lightbulb: LightbulbIcon,
  science: ScienceIcon,
  code: CodeIcon,
  database: StorageIcon,
  link: LinkIcon,
  people: PeopleIcon,
  chat: ChatIcon,
  calendar: CalendarMonthIcon,
  timer: TimerIcon,
  chart: BarChartIcon,
  shield: ShieldIcon,
} as const satisfies Record<WorkItemIconKey, ComponentType<SvgIconProps>>;

const structuredMockupIconMap = {
  task: TaskIcon,
  bug: BugReportIcon,
  feature: FeatureIcon,
  goal: GoalIcon,
  contract: ContractIcon,
  workflow: AccountTreeIcon,
  plan: PlanIcon,
  "plan-stage": AccountTreeIcon,
  add: AddIcon,
  "arrow-down": ArrowDownwardIcon,
  "arrow-left": ArrowBackIcon,
  "arrow-right": ArrowForwardIcon,
  "arrow-up": ArrowUpwardIcon,
  check: CheckIcon,
  close: CloseIcon,
  edit: EditIcon,
  info: InfoOutlinedIcon,
  menu: MenuIcon,
  search: SearchIcon,
  settings: SettingsIcon,
  star: StarIcon,
  warning: WarningAmberIcon,
} as const satisfies Record<
  WorkItemStructuredMockupIconKey,
  ComponentType<SvgIconProps>
>;

export type StructuredMockupIconKey = WorkItemStructuredMockupIconKey;

export const isStructuredMockupIconKey = (
  value: unknown
): value is StructuredMockupIconKey =>
  typeof value === "string" && value in structuredMockupIconMap;

export const getStructuredMockupIcon = (
  iconKey: StructuredMockupIconKey
): ComponentType<SvgIconProps> => structuredMockupIconMap[iconKey];

const TASK_MONITOR_TYPE = "TASK_MONITOR";

const entityColorMap: Record<string, EntityColors> = {
  task: { background: "task.main", color: "task.contrastText" },
  standard: { background: "task.main", color: "task.contrastText" },
  task_monitor: { background: "task.main", color: "task.contrastText" },
  bug: { background: "warning.main", color: "warning.contrastText" },
  mockup: { background: "error.main", color: "error.contrastText" },
  decision: { background: "success.main", color: "success.contrastText" },
  workflow: { background: "plan.main", color: "plan.contrastText" },
  workflow_step: { background: "plan.main", color: "plan.contrastText" },
  diagram: { background: "plan.main", color: "plan.contrastText" },
  diagram_element: { background: "plan.main", color: "plan.contrastText" },
  feature: { background: "feature.main", color: "feature.contrastText" },
  goal: { background: "goal.main", color: "goal.contrastText" },
  contract: { background: "warning.main", color: "warning.contrastText" },
  initiative: { background: "attention.main", color: "attention.contrastText" },
  design_doc: {
    color: "interactive.main",
    background: "interactive.contrastText",
  },
  agent_session: { background: "coding.main", color: "coding.contrastText" },
  service: { background: "service.main", color: "service.contrastText" },
  message: { background: "message.main", color: "message.contrastText" },
  integration: {
    background: "interactive.main",
    color: "interactive.contrastText",
  },
  conversation: { background: "ready.main", color: "ready.contrastText" },
  project: { background: "heyhey.main", color: "heyhey.contrastText" },
  plan: { background: "plan.main", color: "plan.contrastText" },
  step: { background: "plan.main", color: "plan.contrastText" },
  plan_stage: { background: "plan.main", color: "plan.contrastText" },
  plan_step: { background: "plan.main", color: "plan.contrastText" },
  report: { background: "report.main", color: "report.contrastText" },
  proposal: {
    background: "attention.main",
    color: "attention.contrastText",
  },
  user: { background: "action.selected", color: "text.primary" },
};

const defaultEntityColors: EntityColors = {
  background: "action.hover",
  color: "text.secondary",
};

const workItemIconColors = {
  task: { background: "task.main", color: "task.contrastText" },
  bug: { background: "warning.main", color: "warning.contrastText" },
  feature: { background: "feature.main", color: "feature.contrastText" },
  goal: { background: "goal.main", color: "goal.contrastText" },
  contract: { background: "warning.main", color: "warning.contrastText" },
  design: { background: "error.main", color: "error.contrastText" },
  decision: { background: "success.main", color: "success.contrastText" },
  workflow: { background: "plan.main", color: "plan.contrastText" },
  plan: { background: "plan.main", color: "plan.contrastText" },
  "plan-stage": { background: "plan.main", color: "plan.contrastText" },
  star: defaultEntityColors,
  flag: defaultEntityColors,
  folder: defaultEntityColors,
  book: defaultEntityColors,
  lightbulb: defaultEntityColors,
  science: defaultEntityColors,
  code: defaultEntityColors,
  database: defaultEntityColors,
  link: defaultEntityColors,
  people: defaultEntityColors,
  chat: defaultEntityColors,
  calendar: defaultEntityColors,
  timer: defaultEntityColors,
  chart: defaultEntityColors,
  shield: defaultEntityColors,
} as const satisfies Record<WorkItemIconKey, EntityColors>;

const workItemTypeColors: Readonly<Record<string, EntityColors>> = {
  mockup: workItemIconColors.design,
  decision: workItemIconColors.decision,
};

const workItemTypeIcons: Readonly<Record<string, ComponentType<SvgIconProps>>> =
  {
    mockup: workItemIconMap.design,
  };

const transparentEntityColors: EntityColors = {
  background: "transparent",
  color: "inherit",
};

export { ClaudeIcon } from "./icons/Claude";
export { CodexIcon } from "./icons/Codex";
export { getAgentSessionIcon } from "./icons/AgentSessionResolver";

export const getEntityIcon = (
  entityType: string
): ComponentType<SvgIconProps> => {
  const normalizedType = entityType.toLowerCase();

  if (normalizedType in entityIconMap) {
    return entityIconMap[normalizedType as keyof typeof entityIconMap];
  }

  return DesignDocIcon;
};

/**
 * Resolve a task-like icon only from its authoritative type key and registry
 * definition. A missing type key is the legacy STANDARD compatibility path;
 * every typed item must prove that its definition matches before receiving a
 * type-specific icon.
 */
export const resolveWorkItemIcon = (
  taskType: string | undefined,
  definition: WorkItemTypeDefinitionDto | undefined
): ComponentType<SvgIconProps> | undefined => {
  if (taskType === undefined) {
    return workItemIconMap.task;
  }

  if (definition?.key !== taskType) {
    return undefined;
  }

  // TASK_MONITOR uses the existing task registry token for backward
  // compatibility until the shared icon-key palette gains a monitor token.
  if (
    taskType === TASK_MONITOR_TYPE &&
    (definition.iconKey === undefined || definition.iconKey === "task")
  ) {
    return TaskMonitorIcon;
  }

  if (definition.iconKey === undefined) return undefined;

  return workItemIconMap[definition.iconKey];
};

export const getWorkItemIcon = resolveWorkItemIcon;

export interface ResolvedWorkItemIconPresentation {
  Icon: ComponentType<SvgIconProps>;
  colors: EntityColors;
}

/**
 * Resolve icon and color only when the supplied registry definition belongs
 * to the requested work-item type. Canonical type identities can override
 * legacy icon tokens while the registry migration rolls through environments.
 */
export const resolveWorkItemIconPresentation = (
  taskType: string,
  definition: WorkItemTypeDefinitionDto | undefined,
  effectiveSource?: WorkItemTypeEffectiveSource
): ResolvedWorkItemIconPresentation | undefined => {
  if (definition?.key !== taskType) return undefined;

  const iconKey =
    definition.iconKey ??
    (taskType === TASK_MONITOR_TYPE ||
    effectiveSource === "CANONICAL" ||
    effectiveSource === "CANONICAL_OVERRIDE" ||
    (effectiveSource === "PROJECT_CUSTOM" && definition.colorKey !== undefined)
      ? "task"
      : undefined);
  if (iconKey === undefined) return undefined;

  const Icon =
    (definition.iconKey === "task" ? workItemTypeIcons[taskType] : undefined) ??
    resolveWorkItemIcon(taskType, definition) ??
    workItemIconMap[iconKey];
  if (!Icon) return undefined;

  const colors =
    effectiveSource === "PROJECT_CUSTOM" && definition.colorKey
      ? getWorkItemColorTokens(definition.colorKey)
      : effectiveSource === "CANONICAL" ||
        effectiveSource === "CANONICAL_OVERRIDE"
      ? getEntityColors(taskType)
      : workItemTypeColors[taskType] ?? workItemIconColors[iconKey];
  return { Icon, colors };
};

const getWorkItemColorTokens = (colorKey: WorkItemColorKey): EntityColors => ({
  background: `${colorKey}.main`,
  color: `${colorKey}.contrastText`,
});

export const getFallbackEntityColors = (): EntityColors => defaultEntityColors;

export const getEntityColors = (
  entityType: string,
  options: { useDefaultColors?: boolean } = {}
): EntityColors => {
  const { useDefaultColors = true } = options;
  const normalizedType = entityType.toLowerCase();
  const resolvedColors = entityColorMap[normalizedType];

  if (resolvedColors) {
    return resolvedColors;
  }

  return useDefaultColors ? defaultEntityColors : transparentEntityColors;
};
