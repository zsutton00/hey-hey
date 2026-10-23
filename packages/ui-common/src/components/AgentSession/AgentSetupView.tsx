import { AttachmentDropZone } from "./AttachmentDropZone";
import { AttachmentChips } from "./AttachmentChips";
import type { useFileAttachments } from "./runtime/hooks/useFileAttachments";
import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import type { SvgIconComponent } from "@mui/icons-material";
import BoltOutlined from "@mui/icons-material/BoltOutlined";
import BugReportOutlined from "@mui/icons-material/BugReportOutlined";
import CallSplitOutlined from "@mui/icons-material/CallSplitOutlined";
import ChatOutlined from "@mui/icons-material/ChatOutlined";
import ListAltOutlined from "@mui/icons-material/ListAltOutlined";
import ScienceOutlined from "@mui/icons-material/ScienceOutlined";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Checkbox,
  Radio,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import Paper from "@mui/material/Paper";
import { type ReactNode, useMemo, useState } from "react";
import type {
  AgentSessionMethod,
  CodingServiceOption,
  CodingSetupStep,
} from "../AgentSessions/types.js";
import type { ProjectModeSelection } from "../../api";
import type { ProjectModeCatalogEntry } from "../../agents/coordination/projectModeCatalog";
import type { SessionMethod } from "../../agents/coordination/types";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import type { MachineDto } from "../../api";
import {
  ConversationStartRunRequestDtoProviderEnum,
  type ConversationStartRunRequestDtoReasoningEffortEnum,
} from "../../api";
import {
  SESSION_METHOD_GROUP_LISTINGS,
  SESSION_METHOD_REGISTRY,
  type SessionMethodGroup as RegistrySessionMethodGroup,
  type SessionMethodIconKey,
  type SessionMethodStep,
  type SessionMethodTone,
} from "../../agents/coordination/sessionMethodRegistry";
import type { RuntimeModelCatalogSource } from "./useRuntimeModelCatalog";
import { RuntimeModelSelector } from "./RuntimeModelSelector";
import { PromptEditor } from "./PromptEditor";
import { TaskPreviewCard } from "./TaskPreviewCard";
import { WorktreeSetupControls } from "./WorktreeSetupControls";
import type { MachineResolutionMode } from "./runtime/coding/useMachineResolution";
import type { AgentBridgeRecoveryState } from "./agentBridgeRecoveryState";
import { ServiceDirectoryBindingControl } from "../Services/ServiceDirectoryBindingControl";

interface SessionMethodOption {
  value: AgentSessionMethod;
  label: string;
  description: string;
  Icon: SvgIconComponent;
  steps?: readonly SessionMethodStep[];
}

interface SessionMethodGroupUi {
  label: string;
  tone: SessionMethodTone;
  options: readonly SessionMethodOption[];
}

const ICON_BY_KEY: Record<SessionMethodIconKey, SvgIconComponent> = {
  ListAlt: ListAltOutlined,
  Chat: ChatOutlined,
  Bolt: BoltOutlined,
  BugReport: BugReportOutlined,
  Science: ScienceOutlined,
  AccountTree: AccountTreeOutlined,
  CallSplit: CallSplitOutlined,
};

const GROUP_LABEL: Record<RegistrySessionMethodGroup, string> = {
  work: "Work",
  debug: "Debug",
  split: "Split",
};

const SESSION_METHOD_GROUPS: readonly SessionMethodGroupUi[] =
  SESSION_METHOD_GROUP_LISTINGS.map((listing): SessionMethodGroupUi => {
    const options: SessionMethodOption[] = listing.methods.map((method) => {
      const config = SESSION_METHOD_REGISTRY[method];
      return {
        value: method,
        label: config.label,
        description: config.description,
        Icon: ICON_BY_KEY[config.iconKey],
        ...(config.steps ? { steps: config.steps } : {}),
      };
    });
    return {
      label: GROUP_LABEL[listing.group],
      tone: listing.tone,
      options,
    };
  });

const cardGridSx = {
  display: "grid",
  gridTemplateColumns: {
    xs: "1fr",
    sm: "repeat(2, minmax(0, 1fr))",
    lg: "repeat(3, minmax(0, 1fr))",
  },
  gap: 1.5,
};

const sessionMethodGridSx = {
  display: "flex",
  flexWrap: "wrap",
  gap: 1.5,
  "& > *": {
    flex: { xs: "1 1 100%", sm: "0 0 300px" },
  },
} as const;

const matchesSearch = (
  services: readonly CodingServiceOption[],
  searchValue: string,
): CodingServiceOption[] => {
  const normalizedSearch = searchValue.trim().toLowerCase();
  if (normalizedSearch.length === 0) return [...services];
  return services.filter((service) =>
    service.name.toLowerCase().includes(normalizedSearch),
  );
};

const pickerSummary = (description: string): string =>
  description.trim().match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? description.trim();

interface SelectionCardProps {
  title: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  testId: string;
  onClick: () => void;
  recordId?: string;
  leading?: ReactNode;
  tone?: SessionMethodTone;
  steps?: readonly SessionMethodStep[];
}

const SelectionCard = ({
  title,
  description,
  selected,
  disabled,
  testId,
  onClick,
  recordId,
  leading = null,
  tone,
  steps,
}: SelectionCardProps) => (
  <Card
    variant="outlined"
    sx={(theme) => ({
      borderColor: selected
        ? theme.palette.primary.main
        : tone
          ? alpha(theme.palette[tone].main, 0.35)
          : undefined,
      bgcolor: selected
        ? tone
          ? alpha(theme.palette[tone].main, 0.6)
          : theme.palette.action.selected
        : tone
          ? alpha(theme.palette[tone].main, 0.08)
          : undefined,
      transition: theme.transitions.create([
        "border-color",
        "background-color",
      ]),
      ...(tone
        ? {
            "&:hover": {
              bgcolor: alpha(theme.palette[tone].main, 0.22),
              borderColor: alpha(theme.palette[tone].main, 0.5),
            },
          }
        : {}),
    })}
  >
    <CardActionArea
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      {...(recordId ? { "data-mode-id": recordId } : {})}
      sx={{ height: "100%", alignItems: "stretch" }}
    >
      <CardContent sx={{ height: "100%" }}>
        <Stack spacing={1.25} sx={{ height: "100%" }}>
          <Stack direction="row" spacing={1} alignItems="center">
            {leading ? (
              <Box aria-hidden="true" sx={{ display: "flex" }}>
                {leading}
              </Box>
            ) : null}
            <Typography variant="subtitle1" fontWeight={600}>
              {title}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
          {steps && steps.length > 0 ? (
            <Box
              component="ul"
              sx={{
                m: 0,
                pl: 2.5,
                display: "flex",
                flexDirection: "column",
                gap: 0.25,
              }}
            >
              {steps.map((step) => (
                <Typography
                  key={step.name}
                  component="li"
                  variant="body2"
                  color="text.secondary"
                >
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {step.name}
                  </Box>
                  {step.gloss ? ` — ${step.gloss}` : null}
                </Typography>
              ))}
            </Box>
          ) : null}
          {selected ? (
            <Typography variant="caption" color="primary.main" fontWeight={700}>
              Selected
            </Typography>
          ) : null}
        </Stack>
      </CardContent>
    </CardActionArea>
  </Card>
);

interface ServiceSelectionRowProps {
  service: CodingServiceOption;
  fallbackDescription: string;
  selected: boolean;
  disabled: boolean;
  selectionMode: "multiple" | "single";
  testId: "coding-service-row" | "coding-launch-service-row";
  onChange: () => void;
}

const ServiceSelectionRow = ({
  service,
  fallbackDescription,
  selected,
  disabled,
  selectionMode,
  testId,
  onChange,
}: ServiceSelectionRowProps) => (
  <Paper
    component="label"
    variant="outlined"
    data-testid={testId}
    data-service-id={service.id}
    aria-disabled={disabled}
    sx={(theme) => ({
      alignItems: "center",
      bgcolor: selected ? theme.palette.action.selected : undefined,
      borderColor: selected ? theme.palette.primary.main : undefined,
      cursor: disabled ? "default" : "pointer",
      display: "flex",
      height: 40,
      maxHeight: 40,
      minWidth: 0,
      opacity: disabled ? theme.palette.action.disabledOpacity : 1,
      overflow: "hidden",
      px: 0.5,
      transition: theme.transitions.create([
        "border-color",
        "background-color",
      ]),
    })}
  >
    {selectionMode === "multiple" ? (
      <Checkbox
        checked={selected}
        disabled={disabled}
        onChange={onChange}
        size="small"
        slotProps={{
          input: { "aria-label": `Select ${service.name}` },
        }}
        sx={{ p: 0.5, mr: 0.5 }}
      />
    ) : (
      <Radio
        checked={selected}
        disabled={disabled}
        name="coding-launch-service"
        onChange={onChange}
        size="small"
        slotProps={{
          input: { "aria-label": `Launch from ${service.name}` },
        }}
        sx={{ p: 0.5, mr: 0.5 }}
      />
    )}
    <Typography
      variant="body2"
      fontWeight={600}
      noWrap
      sx={{ flexShrink: 0, maxWidth: "40%", mr: 1 }}
    >
      {service.name}
    </Typography>
    <Typography
      variant="caption"
      color="text.secondary"
      data-testid="coding-service-description"
      sx={{
        display: "-webkit-box",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 2,
      }}
    >
      {service.description || fallbackDescription}
    </Typography>
  </Paper>
);

export interface AgentSetupViewProps {
  /** Retained for callers during the step-collapse migration; rendering is no longer step-gated. */
  step: CodingSetupStep;
  primaryServices: CodingServiceOption[];
  additionalServices: CodingServiceOption[];
  loadingServices: boolean;
  /** Why the Service list failed to load; null when it loaded. */
  servicesError: string | null;
  selectedServiceId: string | null;
  selectedServiceIds: string[];
  isMultiServiceMode: boolean;
  serviceSelectionLocked: boolean;
  onSelectService: (serviceId: string) => void;
  onToggleService: (serviceId: string) => void;
  onContinueToSelection: () => void;
  onBackToSessionMethod: () => void;
  sessionMethod: AgentSessionMethod | null;
  onSelectSessionMethod: (method: AgentSessionMethod) => void;
  compatibleSessionMethods: readonly SessionMethod[];
  projectModeCatalog: readonly ProjectModeCatalogEntry[];
  projectModeCatalogLoading: boolean;
  projectModeCatalogError: string | null;
  projectModeSelection: ProjectModeSelection | null;
  onSelectProjectMode: (selection: ProjectModeSelection) => void;
  recoveryState: AgentBridgeRecoveryState;
  repositoryPath: string;
  directoryPaths?: Record<string, string>;
  worktreeBranch: string | null;
  worktreeLocked: boolean;
  setWorktreeBranch: (branch: string | null) => void;
  launchServiceId?: string | null;
  onSelectLaunchService?: (serviceId: string) => void;
  hasActiveRun: boolean;
  canStartCoding: boolean;
  onStartValidation?: () => void;
  startingValidation?: boolean;
  skipServiceSelection?: boolean;
  promptAttachments?: ReturnType<typeof useFileAttachments>;
  promptDraft: string;
  onPromptDraftChange: (value: string) => void;
  onSubmitPrompt: () => void;
  onBackToSelection: () => void;
  submittingPrompt: boolean;
  launchErrorMessages: readonly string[];
  /** The machine whose CLI offers the model choices; null until one is picked. */
  catalogSource: RuntimeModelCatalogSource | null;
  /** Null until the picked machine's CLI catalog has loaded. */
  promptProvider: ConversationStartRunRequestDtoProviderEnum | null;
  promptModel: string | null;
  promptReasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum | null;
  promptFastMode: boolean;
  onPromptProviderChange: (
    provider: ConversationStartRunRequestDtoProviderEnum,
  ) => void;
  onPromptModelChange: (model: string | null) => void;
  onPromptReasoningEffortChange: (
    effort: ConversationStartRunRequestDtoReasoningEffortEnum | null,
  ) => void;
  onPromptFastModeChange: (fastMode: boolean) => void;
  taskData?: WorkItemResponseDto | null;
  machines: MachineDto[];
  machineMode: MachineResolutionMode;
  selectedMachineId: string | null;
  onSelectMachine: (machineId: string) => void;
  /**
   * Opens Service creation from the no-Service state. Null when the host
   * cannot open the Create Service modal, in which case the state explains
   * the missing Service without an action.
   */
  onAddService: (() => void) | null;
}

export const AgentSetupView = ({
  primaryServices,
  additionalServices,
  loadingServices,
  servicesError,
  selectedServiceId,
  selectedServiceIds,
  isMultiServiceMode,
  serviceSelectionLocked,
  onSelectService,
  onToggleService,
  sessionMethod,
  onSelectSessionMethod,
  compatibleSessionMethods,
  projectModeCatalog,
  projectModeCatalogLoading,
  projectModeCatalogError,
  projectModeSelection,
  onSelectProjectMode,
  recoveryState,
  repositoryPath,
  directoryPaths,
  worktreeBranch,
  worktreeLocked,
  setWorktreeBranch,
  launchServiceId,
  onSelectLaunchService,
  canStartCoding,
  onStartValidation,
  startingValidation,
  skipServiceSelection,
  promptAttachments,
  promptDraft,
  onPromptDraftChange,
  onSubmitPrompt,
  submittingPrompt,
  launchErrorMessages,
  catalogSource,
  promptProvider,
  promptModel,
  promptReasoningEffort,
  promptFastMode,
  onPromptProviderChange,
  onPromptModelChange,
  onPromptReasoningEffortChange,
  onPromptFastModeChange,
  taskData = null,
  machines,
  machineMode,
  selectedMachineId,
  onSelectMachine,
  onAddService,
}: AgentSetupViewProps) => {
  const [serviceSearchValue, setServiceSearchValue] = useState("");
  const compatibleSessionMethodGroups = useMemo(() => {
    const compatibleMethods = new Set(compatibleSessionMethods);
    return SESSION_METHOD_GROUPS.map((group) => ({
      ...group,
      options: group.options.filter(({ value }) =>
        compatibleMethods.has(value as SessionMethod),
      ),
    })).filter(({ options }) => options.length > 0);
  }, [compatibleSessionMethods]);
  const filteredPrimaryServices = useMemo(
    () => matchesSearch(primaryServices, serviceSearchValue),
    [primaryServices, serviceSearchValue],
  );
  const filteredAdditionalServices = useMemo(
    () => matchesSearch(additionalServices, serviceSearchValue),
    [additionalServices, serviceSearchValue],
  );
  const combinedServices = [...primaryServices, ...additionalServices];
  const hasFilteredServices =
    filteredPrimaryServices.length > 0 || filteredAdditionalServices.length > 0;
  const isValidation = sessionMethod === "validation";

  const isServiceSelected = (id: string) =>
    isMultiServiceMode
      ? selectedServiceIds.includes(id)
      : selectedServiceId === id;
  const handleServiceClick = (id: string) =>
    isMultiServiceMode ? onToggleService(id) : onSelectService(id);

  const promptPlaceholder =
    sessionMethod === "open"
      ? "Describe what you'd like to discuss or work on."
      : undefined;

  return (
    <Stack
      spacing={2}
      data-testid="coding-setup-one-screen"
      sx={{ minWidth: 0 }}
    >
      {taskData ? <TaskPreviewCard task={taskData} defaultExpanded /> : null}

      <Card variant="outlined" data-testid="coding-setup-session-method">
        <CardContent>
          <Stack
            component="fieldset"
            disabled={submittingPrompt}
            spacing={3}
            sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}
          >
            <Box>
              <Typography variant="h6">Session setup</Typography>
              <Typography variant="body2" color="text.secondary">
                Choose the session method and configure the complete launch in
                one place. Nothing is materialized until you submit the prompt.
              </Typography>
            </Box>
            <Stack spacing={2.5}>
              {compatibleSessionMethodGroups.map((group) => (
                <Box key={group.label}>
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    sx={{ mb: 1 }}
                  >
                    {group.label}
                  </Typography>
                  <Box sx={sessionMethodGridSx}>
                    {group.options.map(
                      ({ value, label, description, Icon, steps }) => (
                        <SelectionCard
                          key={value}
                          title={label}
                          description={description}
                          selected={
                            !projectModeSelection && sessionMethod === value
                          }
                          disabled={false}
                          testId={`coding-method-card-${value}`}
                          onClick={() => onSelectSessionMethod(value)}
                          leading={<Icon color="action" />}
                          tone={group.tone}
                          steps={steps}
                        />
                      ),
                    )}
                  </Box>
                </Box>
              ))}
            </Stack>
            {taskData ? (
              <Box data-testid="coding-project-mode-catalog">
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  Agent Modes
                </Typography>
                {projectModeCatalogLoading ? (
                  <Box
                    sx={cardGridSx}
                    data-testid="coding-project-mode-loading"
                  >
                    {[0, 1].map((index) => (
                      <Card variant="outlined" key={index}>
                        <CardContent>
                          <Stack spacing={1}>
                            <Skeleton variant="text" width="55%" />
                            <Skeleton variant="text" width="90%" />
                            <Skeleton variant="text" width="75%" />
                          </Stack>
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                ) : null}
                {!projectModeCatalogLoading && projectModeCatalogError ? (
                  <Alert severity="error">{projectModeCatalogError}</Alert>
                ) : null}
                {!projectModeCatalogLoading &&
                !projectModeCatalogError &&
                projectModeCatalog.length === 0 ? (
                  <Alert severity="info">
                    No Agent Modes are available for this work item.
                  </Alert>
                ) : null}
                {!projectModeCatalogLoading && !projectModeCatalogError ? (
                  <Box sx={sessionMethodGridSx}>
                    {projectModeCatalog.map((mode) => (
                      <SelectionCard
                        key={mode.selection.modeId}
                        title={mode.name}
                        description={pickerSummary(mode.description)}
                        selected={
                          projectModeSelection?.modeId === mode.selection.modeId
                        }
                        disabled={false}
                        testId="coding-project-mode-card"
                        recordId={mode.selection.modeId}
                        onClick={() => onSelectProjectMode(mode.selection)}
                        tone="info"
                      />
                    ))}
                  </Box>
                ) : null}
              </Box>
            ) : null}
            {isValidation ? (
              <Button
                type="button"
                variant="contained"
                onClick={onStartValidation}
                disabled={Boolean(startingValidation) || !onStartValidation}
                data-testid="coding-setup-start-validation-button"
              >
                {startingValidation
                  ? "Starting..."
                  : "Start Validation Session"}
              </Button>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      {!isValidation && !skipServiceSelection ? (
        <Card variant="outlined" data-testid="coding-setup-selection">
          <CardContent>
            <Stack
              component="fieldset"
              disabled={submittingPrompt}
              spacing={3}
              sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}
            >
              <Box>
                <Typography variant="h6">Services and workspaces</Typography>
                <Typography variant="body2" color="text.secondary">
                  Select every Service the session may use, map each local
                  directory, and choose the launch Service.
                </Typography>
              </Box>

              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Services</Typography>
                <TextField
                  label="Search services"
                  value={serviceSearchValue}
                  onChange={(event) =>
                    setServiceSearchValue(event.target.value)
                  }
                  placeholder="Filter services by name"
                  fullWidth
                  data-testid="coding-service-search"
                />
                {loadingServices ? (
                  <Box sx={cardGridSx}>
                    {[0, 1, 2].map((index) => (
                      <Card variant="outlined" key={index}>
                        <CardContent>
                          <Stack spacing={1}>
                            <Skeleton variant="text" width="55%" />
                            <Skeleton variant="text" width="90%" />
                            <Skeleton variant="text" width="35%" />
                          </Stack>
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                ) : null}
                {!loadingServices && filteredPrimaryServices.length > 0 ? (
                  <Stack spacing={1}>
                    <Typography variant="caption" color="text.secondary">
                      Task Services
                    </Typography>
                    <Stack spacing={0.5}>
                      {filteredPrimaryServices.map((service) => (
                        <ServiceSelectionRow
                          key={service.id}
                          service={service}
                          fallbackDescription="Linked to this task"
                          selected={isServiceSelected(service.id)}
                          disabled={serviceSelectionLocked}
                          selectionMode="multiple"
                          testId="coding-service-row"
                          onChange={() => handleServiceClick(service.id)}
                        />
                      ))}
                    </Stack>
                  </Stack>
                ) : null}
                {!loadingServices && filteredAdditionalServices.length > 0 ? (
                  <Stack spacing={1}>
                    <Typography variant="caption" color="text.secondary">
                      Other Services
                    </Typography>
                    <Stack spacing={0.5}>
                      {filteredAdditionalServices.map((service) => (
                        <ServiceSelectionRow
                          key={service.id}
                          service={service}
                          fallbackDescription="Available in this project"
                          selected={isServiceSelected(service.id)}
                          disabled={serviceSelectionLocked}
                          selectionMode="multiple"
                          testId="coding-service-row"
                          onChange={() => handleServiceClick(service.id)}
                        />
                      ))}
                    </Stack>
                  </Stack>
                ) : null}
                {!loadingServices &&
                combinedServices.length === 0 &&
                servicesError !== null ? (
                  <Alert
                    severity="error"
                    data-testid="coding-setup-services-error"
                  >
                    Services could not be loaded: {servicesError}
                  </Alert>
                ) : null}
                {!loadingServices &&
                combinedServices.length === 0 &&
                servicesError === null ? (
                  <Stack spacing={1.5} data-testid="coding-setup-no-service">
                    <Typography variant="subtitle2">
                      This project has no Service yet
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      A Service is the code base a coding session works in. Add
                      one to continue.
                    </Typography>
                    {onAddService ? (
                      <Box>
                        <Button
                          variant="contained"
                          onClick={onAddService}
                          data-testid="coding-setup-add-service"
                        >
                          Add a service
                        </Button>
                      </Box>
                    ) : null}
                  </Stack>
                ) : null}
                {!loadingServices &&
                combinedServices.length > 0 &&
                !hasFilteredServices ? (
                  <Alert severity="info">
                    No services match the current search.
                  </Alert>
                ) : null}
              </Stack>

              {selectedServiceIds.length > 1 ? (
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="subtitle2">Launch from</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Choose the selected Service that anchors the session's
                      process and working directory.
                    </Typography>
                  </Box>
                  <Stack
                    spacing={0.5}
                    role="radiogroup"
                    aria-label="Launch from"
                  >
                    {selectedServiceIds.map((id) => {
                      const service = combinedServices.find(
                        (item) => item.id === id,
                      );
                      if (!service) return null;
                      return (
                        <ServiceSelectionRow
                          key={id}
                          service={service}
                          fallbackDescription="Start the agent here; the other selected Services remain in scope."
                          selected={launchServiceId === id}
                          disabled={false}
                          selectionMode="single"
                          testId="coding-launch-service-row"
                          onChange={() => onSelectLaunchService?.(id)}
                        />
                      );
                    })}
                  </Stack>
                </Stack>
              ) : null}

              <Card variant="outlined" data-testid="coding-worktree-card">
                <CardContent>
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant="subtitle2">
                        Worktree and repositories
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Keep the selected Services on the configured branch and
                        resolve a local directory for each one.
                      </Typography>
                    </Box>
                    <WorktreeSetupControls
                      branch={worktreeBranch}
                      locked={worktreeLocked}
                      onChangeBranch={setWorktreeBranch}
                      toggleTestId="coding-worktree-toggle"
                      controlsTestId="coding-worktree-controls"
                      branchTestId="coding-worktree-branch-name"
                    />
                    <Stack spacing={1.5}>
                      <Typography variant="subtitle2">
                        Repository paths
                      </Typography>
                      {selectedServiceIds.map((id) => {
                        const service = combinedServices.find(
                          (item) => item.id === id,
                        );
                        const label = service?.name ?? id;
                        const value =
                          directoryPaths?.[id] ??
                          (launchServiceId === id ? repositoryPath : "");
                        return (
                          <Stack
                            key={id}
                            direction={{ xs: "column", sm: "row" }}
                            spacing={1.5}
                            alignItems={{ sm: "center" }}
                            sx={{ maxWidth: 720 }}
                          >
                            <TextField
                              label={`${label} repository path`}
                              value={value}
                              placeholder="/absolute/path/to/repo"
                              fullWidth
                              size="small"
                              slotProps={{ input: { readOnly: true } }}
                              data-testid={`coding-repository-path-${id}`}
                            />
                            <ServiceDirectoryBindingControl
                              serviceId={id}
                              serviceName={label}
                              showPath={false}
                            />
                          </Stack>
                        );
                      })}
                      {selectedServiceIds.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          Select at least one Service to configure its
                          repository path.
                        </Typography>
                      ) : null}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      {!isValidation ? (
        <Card variant="outlined" data-testid="coding-setup-prompt">
          <CardContent>
            <Stack
              component="fieldset"
              disabled={submittingPrompt}
              spacing={3}
              sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}
            >
              <Box>
                <Typography variant="h6">Agent and prompt</Typography>
                <Typography variant="body2" color="text.secondary">
                  Review the runtime choices and submit the initial prompt to
                  materialize the session.
                </Typography>
              </Box>
              <Stack spacing={1.5} data-testid="coding-runtime-configuration">
                <RuntimeModelSelector
                  testIdPrefix="coding-agent"
                  catalogSource={catalogSource}
                  provider={promptProvider}
                  model={promptModel}
                  reasoningEffort={promptReasoningEffort}
                  fastMode={promptFastMode}
                  onProviderChange={onPromptProviderChange}
                  onModelChange={onPromptModelChange}
                  onReasoningEffortChange={onPromptReasoningEffortChange}
                  onFastModeChange={onPromptFastModeChange}
                  machineSelection={{
                    machines,
                    machineMode,
                    selectedMachineId,
                    onSelectMachine: onSelectMachine,
                    recoveryState,
                  }}
                />
              </Stack>
              <AttachmentDropZone
                testId="initial-prompt-attachment-drop-zone"
                scopeKey={selectedMachineId ?? ""}
                attachments={
                  promptAttachments ?? { canDrop: false, drop: () => undefined }
                }
              >
                {promptAttachments?.rejection ? (
                  <Alert
                    severity="error"
                    data-testid="run-attachment-rejection"
                  >
                    {promptAttachments.rejection}
                  </Alert>
                ) : null}
                {promptAttachments ? (
                  <AttachmentChips attachments={promptAttachments} />
                ) : null}
                <PromptEditor
                  prompt={promptDraft}
                  submittingPrompt={submittingPrompt}
                  submitDisabled={
                    submittingPrompt ||
                    !canStartCoding ||
                    Boolean(promptAttachments?.blocked)
                  }
                  submitDisabledReason={
                    canStartCoding
                      ? null
                      : "Complete the Service, repository, runtime, and machine setup before submitting."
                  }
                  onPromptChange={onPromptDraftChange}
                  onSubmitPrompt={onSubmitPrompt}
                  errorMessages={launchErrorMessages}
                  {...(promptPlaceholder
                    ? { placeholder: promptPlaceholder }
                    : {})}
                />
              </AttachmentDropZone>
            </Stack>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  );
};
