import AddIcon from "@mui/icons-material/Add";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  MachineDto,
  RepositoryGroundingFieldPayload,
  ServiceDto,
} from "../../../api";
import { useModalService } from "../../../contexts/ModalService";
import {
  useMachineRepoBindings,
  useServices,
  useUserPairedMachines,
} from "../../../data/hooks";
import { MachinePicker } from "../../AgentSession/MachinePicker";
import {
  listEfforts,
  listModels,
  listProviders,
  supportsFastMode,
} from "../../AgentSession/capabilityCatalog";
import {
  CatalogLoadingAlert,
  CatalogMachineRequiredAlert,
  CatalogUnavailableAlert,
  RuntimeModelSelector,
} from "../../AgentSession/RuntimeModelSelector";
import {
  type RuntimeModelCatalogSource,
  useRuntimeModelCatalog,
} from "../../AgentSession/useRuntimeModelCatalog";
import {
  buildDefaultSurfaceSelection,
  readSurfaceSelection,
  SERVICE_IMPORT_SURFACE_ID,
  writeSurfaceSelection,
  type SurfaceSelection,
} from "../../AgentSession/surfaceSelectionMemory";
import {
  classifyMachineExecutionReadiness,
  getMachineExecutionLabel,
} from "../../AgentSession/runtime/coding/machineExecutionReadiness";
import { ServiceSelector } from "../../Selectors/ServiceSelector";
import { ServiceDirectoryBindingControl } from "../../Services/ServiceDirectoryBindingControl";
import type { FieldComponentProps, FieldConfig } from "./types";
import {
  buildRepositoryGroundingSubmission,
  getRepositoryGroundingPhaseLabel,
  getRepositoryGroundingProviderLabel,
  getRepositoryGroundingValidation,
  normalizeRepositoryGroundingValue,
  readRepositoryGroundingPayload,
  RepositoryGroundingNextAction,
  type RepositoryGroundingNextAction as RepositoryGroundingNextActionType,
  type RepositoryGroundingPayloadProjection,
  type RepositoryGroundingSubmission,
  type RepositoryGroundingValue,
} from "./repositoryGroundingUtils";

const ACTIVE_PHASES: ReadonlySet<RepositoryGroundingValue["phase"]> = new Set([
  "queued",
  "running",
  "disconnected",
  "retryable-error",
  "failed",
  "finished-later",
  "completed",
] as const);

const isFreshRepositoryGroundingSetup = (
  value: RepositoryGroundingValue,
): boolean => !ACTIVE_PHASES.has(value.phase);

type BindingState = "checking" | "missing" | "ready";

export interface RepositoryGroundingFieldConfig extends Omit<
  FieldConfig,
  "payload"
> {
  payload?: RepositoryGroundingFieldPayload;
}

export interface RepositoryGroundingFieldProps extends Omit<
  FieldComponentProps<RepositoryGroundingValue>,
  "config" | "onSubmitValue"
> {
  config: RepositoryGroundingFieldConfig;
  onSubmitValue?: (value: RepositoryGroundingSubmission) => void;
  onLaunchAnalysis?: (
    submission: RepositoryGroundingSubmission,
  ) => Promise<void>;
}

interface RepositoryGroundingRegistryFieldProps extends Omit<
  FieldComponentProps,
  "onSubmitValue"
> {
  onSubmitValue?: (value: RepositoryGroundingSubmission) => void;
}

const getServiceName = (service: ServiceDto | undefined): string =>
  service?.name?.trim() || "Selected Service";

const getMachineName = (machine: MachineDto | undefined): string =>
  machine?.name?.trim() || "Selected CLI machine";

const hasServiceBinding = (
  bindings: readonly { serviceId: string }[] | null | undefined,
  serviceId: string | null,
): boolean =>
  serviceId !== null &&
  bindings?.some((binding) => binding.serviceId === serviceId) === true;

const getBindingState = ({
  serviceId,
  machine,
  liveBindings,
  optimisticBinding,
}: {
  serviceId: string | null;
  machine: MachineDto | undefined;
  liveBindings: ReturnType<typeof useMachineRepoBindings>;
  optimisticBinding: { serviceId: string; machineId: string } | null;
}): BindingState => {
  if (!serviceId || !machine) return "missing";

  const isOptimisticallyBound =
    optimisticBinding?.serviceId === serviceId &&
    optimisticBinding.machineId === machine.machineId;
  if (isOptimisticallyBound) return "ready";

  const hasKnownBindings =
    liveBindings !== null || machine.bindings !== undefined;
  if (!hasKnownBindings) return "checking";

  return hasServiceBinding(liveBindings ?? machine.bindings, serviceId)
    ? "ready"
    : "missing";
};

const updateValueWithoutAction = (
  value: RepositoryGroundingValue,
  patch: Partial<RepositoryGroundingValue>,
): RepositoryGroundingValue => {
  const nextValue: RepositoryGroundingValue = { ...value, ...patch };
  delete nextValue.nextAction;
  return nextValue;
};

const ChoiceSummary = ({
  value,
  service,
  machine,
}: {
  value: RepositoryGroundingValue;
  service: ServiceDto | undefined;
  machine: MachineDto | undefined;
}) => (
  <Stack spacing={0.5} data-testid="repository-grounding-choice-summary">
    <Typography variant="body2">
      <strong>Service:</strong> {getServiceName(service)}
    </Typography>
    <Typography variant="body2">
      <strong>CLI machine:</strong> {getMachineName(machine)}
    </Typography>
    <Typography variant="body2">
      <strong>Scope:</strong> {value.scope ?? "Not chosen"}
      {value.scope === "focused" && value.focus.trim()
        ? ` · ${value.focus.trim()}`
        : ""}
    </Typography>
    <Typography variant="body2">
      <strong>Provider:</strong>{" "}
      {getRepositoryGroundingProviderLabel(value.provider)}
      {value.model ? ` · ${value.model}` : ""}
    </Typography>
  </Stack>
);

const StatusPanel = ({
  value,
  service,
  machine,
  validation,
  disabled,
  isLaunching,
  onAction,
  presentation,
}: {
  value: RepositoryGroundingValue;
  service: ServiceDto | undefined;
  machine: MachineDto | undefined;
  validation: ReturnType<typeof getRepositoryGroundingValidation>;
  disabled: boolean;
  isLaunching: boolean;
  onAction: (action: RepositoryGroundingNextActionType) => void;
  presentation: RepositoryGroundingPayloadProjection;
}) => {
  const phase = value.phase;
  const isRetryable = phase === "disconnected" || phase === "retryable-error";
  const isResumable = phase === "finished-later";
  const isComplete = phase === "completed";
  const isRunning = phase === "queued" || phase === "running";
  const severity =
    phase === "failed" || phase === "retryable-error" ? "error" : "info";

  return (
    <Stack spacing={2} data-testid="repository-grounding-analysis-status">
      <Alert severity={isComplete ? "success" : severity} aria-live="polite">
        <Typography variant="subtitle2">
          {getRepositoryGroundingPhaseLabel(phase)}
        </Typography>
        {value.statusMessage || presentation.statusMessage ? (
          <Typography variant="body2">
            {value.statusMessage ?? presentation.statusMessage}
          </Typography>
        ) : null}
        {value.errorMessage || presentation.errorMessage ? (
          <Typography variant="body2">
            {value.errorMessage ?? presentation.errorMessage}
          </Typography>
        ) : null}
        {value.resultSummary || presentation.resultSummary ? (
          <Typography variant="body2">
            {value.resultSummary ?? presentation.resultSummary}
          </Typography>
        ) : null}
      </Alert>

      {value.progress !== null || presentation.progress !== null ? (
        <Box
          role="progressbar"
          aria-label="Repository analysis progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value.progress ?? presentation.progress ?? undefined}
          sx={{
            height: 8,
            borderRadius: 1,
            backgroundColor: "action.hover",
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              height: "100%",
              width: `${value.progress ?? presentation.progress ?? 0}%`,
              backgroundColor: "primary.main",
              transition: "width 200ms ease",
            }}
          />
        </Box>
      ) : isRunning ? (
        <CircularProgress
          size={24}
          aria-label="Repository analysis progress loading"
        />
      ) : null}

      <ChoiceSummary value={value} service={service} machine={machine} />

      {isRetryable || isResumable || isComplete || isRunning ? (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          {isRetryable || isResumable ? (
            <Button
              variant="contained"
              disabled={disabled || !validation.valid}
              aria-busy={isLaunching}
              onClick={() =>
                onAction(
                  isResumable
                    ? RepositoryGroundingNextAction.StartAnalysis
                    : RepositoryGroundingNextAction.RetryAnalysis,
                )
              }
              data-testid="repository-grounding-retry"
            >
              {isResumable ? "Resume analysis" : "Retry analysis"}
            </Button>
          ) : null}
          {isRunning ? (
            <Button
              variant="outlined"
              disabled={disabled || !validation.valid}
              onClick={() =>
                onAction(RepositoryGroundingNextAction.FinishLater)
              }
              data-testid="repository-grounding-finish-later"
            >
              Finish later
            </Button>
          ) : null}
          {isComplete ? (
            <Button
              variant="outlined"
              disabled={disabled || !validation.valid}
              onClick={() =>
                onAction(RepositoryGroundingNextAction.ContinueConversation)
              }
              data-testid="repository-grounding-continue"
            >
              Continue conversation
            </Button>
          ) : null}
        </Stack>
      ) : null}

      {phase === "failed" ? (
        <Alert severity="warning">
          Continue the conversation to decide how to proceed with this analysis.
        </Alert>
      ) : null}
    </Stack>
  );
};

interface RepositoryGroundingPrerequisitesProps {
  context: RepositoryGroundingFieldProps["context"];
  value: RepositoryGroundingValue;
  selectedService: ServiceDto | undefined;
  selectedMachine: MachineDto | undefined;
  selectedMachineReady: boolean;
  bindingState: BindingState;
  servicesError: Error | null | undefined;
  machines: readonly MachineDto[];
  machinesLoading: boolean;
  machinesError: Error | null | undefined;
  canCreateService: boolean;
  disabled: boolean;
  isSubmitted: boolean;
  onChange: (patch: Partial<RepositoryGroundingValue>) => void;
  onServiceChange: (serviceId: string | null, service?: ServiceDto) => void;
  onCreateService: () => void;
  onMachineSelect: (machineId: string) => void;
  onLinked: () => void;
}

const RepositoryGroundingPrerequisites = ({
  context,
  value,
  selectedService,
  selectedMachine,
  selectedMachineReady,
  bindingState,
  servicesError,
  machines,
  machinesLoading,
  machinesError,
  canCreateService,
  disabled,
  isSubmitted,
  onChange,
  onServiceChange,
  onCreateService,
  onMachineSelect,
  onLinked,
}: RepositoryGroundingPrerequisitesProps) => (
  <Stack spacing={2} data-testid="repository-grounding-prerequisites">
    <Typography variant="h6">Repository prerequisites</Typography>
    <Typography variant="body2" color="text.secondary">
      Choose exactly one Service, confirm its brief, and connect a ready CLI
      machine to a local directory.
    </Typography>

    <Stack spacing={1}>
      <Box
        sx={{
          display: "flex",
          gap: 1,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <Box sx={{ flex: "1 1 320px", minWidth: 0 }}>
          <ServiceSelector
            organizationId={context.organizationId}
            projectId={context.projectId}
            value={value.serviceId}
            onChange={onServiceChange}
            label="Service"
            placeholder="Select one Service"
            helperText="Select exactly one Service"
            disabled={disabled || isSubmitted}
            error={Boolean(servicesError)}
          />
        </Box>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={onCreateService}
          disabled={disabled || isSubmitted || !canCreateService}
          data-testid="repository-grounding-create-service"
        >
          Create Service
        </Button>
      </Box>
      {servicesError ? (
        <Alert severity="warning">
          Services could not be loaded. Refresh and try selecting the existing
          Service again.
        </Alert>
      ) : null}
    </Stack>

    <TextField
      label="Service brief"
      value={value.brief}
      onChange={(event) => onChange({ brief: event.target.value })}
      placeholder="Briefly describe what this Service contains"
      helperText="Required. This brief is sent with the analysis request."
      multiline
      minRows={3}
      fullWidth
      required
      disabled={disabled || isSubmitted}
      error={!value.brief.trim() && isSubmitted}
      data-testid="repository-grounding-brief"
    />

    <Stack spacing={1}>
      <Typography variant="subtitle2">CLI machine</Typography>
      {machinesLoading ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={20} aria-label="Loading CLI machines" />
          <Typography variant="body2" color="text.secondary">
            Loading paired CLI machines...
          </Typography>
        </Stack>
      ) : machinesError ? (
        <Alert severity="warning">
          Paired CLI machines could not be loaded. Refresh to restore a ready
          machine.
        </Alert>
      ) : machines.length === 0 ? (
        <Alert severity="info">
          Pair a CLI machine before continuing with repository analysis.
        </Alert>
      ) : (
        <MachinePicker
          machines={[...machines]}
          selectedMachineId={value.machineId}
          onSelect={onMachineSelect}
          disabled={disabled || isSubmitted}
          mobileMode="editor"
        />
      )}
      {selectedMachine && !selectedMachineReady ? (
        <Alert severity="error">
          {getMachineExecutionLabel(selectedMachine)} is not ready for local
          analysis. Select a ready machine.
        </Alert>
      ) : null}
    </Stack>

    {value.serviceId && value.machineId && selectedMachineReady ? (
      <Stack spacing={1}>
        <Typography variant="subtitle2">Local directory</Typography>
        {bindingState === "checking" ? (
          <Typography variant="body2" color="text.secondary">
            Checking the selected machine's directory binding...
          </Typography>
        ) : bindingState === "ready" ? (
          <Alert severity="success">
            The Service is bound to the selected machine's local directory.
          </Alert>
        ) : null}
        <ServiceDirectoryBindingControl
          serviceId={value.serviceId}
          serviceName={getServiceName(selectedService)}
          machineId={value.machineId}
          isBound={bindingState === "ready"}
          showPath={false}
          onLinked={onLinked}
        />
      </Stack>
    ) : (
      <Typography variant="body2" color="text.secondary">
        Select a Service and a ready CLI machine to link a local directory.
      </Typography>
    )}
  </Stack>
);

interface RepositoryGroundingAnalysisChoicesProps {
  /** The machine picked above; its CLI decides which models are offered. */
  catalogSource: RuntimeModelCatalogSource | null;
  value: RepositoryGroundingValue;
  validation: ReturnType<typeof getRepositoryGroundingValidation>;
  disabled: boolean;
  isLaunching: boolean;
  isSubmitted: boolean;
  onChange: (patch: Partial<RepositoryGroundingValue>) => void;
  onStart: () => void;
}

const isCatalogProvider = (
  provider: string | null,
): provider is ConversationStartRunRequestDtoProviderEnum =>
  provider !== null &&
  listProviders().some((candidate) => candidate === provider);

const getDefaultEffort = (
  provider: ConversationStartRunRequestDtoProviderEnum,
  model: string,
): ConversationStartRunRequestDtoReasoningEffortEnum | null => {
  const efforts = listEfforts(provider, model);
  return efforts.includes("medium") ? "medium" : (efforts[0] ?? null);
};

const hasCompleteRuntimeSelection = (
  value: RepositoryGroundingValue,
): boolean => {
  const { provider, model, reasoningEffort, fastMode } = value;
  if (!provider || !model || !reasoningEffort) return false;
  if (
    !listModels(provider).some((candidate) => candidate.id === model) ||
    !listEfforts(provider, model).includes(reasoningEffort)
  ) {
    return false;
  }
  return supportsFastMode(provider, model)
    ? fastMode !== null
    : fastMode === null;
};

const hasRuntimeSelectionInput = (value: RepositoryGroundingValue): boolean =>
  value.provider !== null ||
  value.model !== null ||
  value.reasoningEffort !== null ||
  value.fastMode !== null;

const toRepositoryGroundingSelection = (
  value: RepositoryGroundingValue,
  selection: SurfaceSelection,
): RepositoryGroundingValue => ({
  ...value,
  provider: selection.provider,
  model: selection.model,
  reasoningEffort: selection.reasoningEffort,
  fastMode: supportsFastMode(selection.provider, selection.model)
    ? (selection.fastMode ?? false)
    : null,
});

const toSurfaceSelection = (
  value: RepositoryGroundingValue,
): SurfaceSelection | null => {
  if (!hasCompleteRuntimeSelection(value) || !value.provider || !value.model) {
    return null;
  }
  return {
    provider: value.provider,
    model: value.model,
    reasoningEffort: value.reasoningEffort,
    ...(supportsFastMode(value.provider, value.model)
      ? { fastMode: value.fastMode === true }
      : {}),
  };
};

const resolveFreshRuntimeSelection = (
  value: RepositoryGroundingValue,
): RepositoryGroundingValue => {
  if (!isFreshRepositoryGroundingSetup(value)) return value;
  if (hasRuntimeSelectionInput(value)) return value;

  const rememberedSelection = readSurfaceSelection(SERVICE_IMPORT_SURFACE_ID);
  const selection =
    rememberedSelection !== null && rememberedSelection.reasoningEffort !== null
      ? rememberedSelection
      : buildDefaultSurfaceSelection();
  return selection === null || selection.reasoningEffort === null
    ? value
    : toRepositoryGroundingSelection(value, selection);
};

const RepositoryGroundingAnalysisChoices = ({
  catalogSource,
  value,
  validation,
  disabled,
  isLaunching,
  isSubmitted,
  onChange,
  onStart,
}: RepositoryGroundingAnalysisChoicesProps) => {
  const catalogState = useRuntimeModelCatalog(catalogSource);
  const catalogProvider = isCatalogProvider(value.provider)
    ? value.provider
    : undefined;
  const catalogModel = catalogProvider
    ? listModels(catalogProvider).some((model) => model.id === value.model)
      ? value.model
      : undefined
    : undefined;
  const runtimeTargetRef = useRef({
    provider: catalogProvider,
    model: catalogModel,
  });
  runtimeTargetRef.current = {
    provider: catalogProvider,
    model: catalogModel,
  };

  const handleProviderChange = (
    provider: ConversationStartRunRequestDtoProviderEnum,
  ): void => {
    const model = listModels(provider)[0]?.id;
    if (!model) return;
    const reasoningEffort = getDefaultEffort(provider, model);
    runtimeTargetRef.current = { provider, model };
    onChange({
      provider,
      model,
      reasoningEffort,
      fastMode: supportsFastMode(provider, model) ? false : null,
    });
  };

  const handleModelChange = (model: string): void => {
    const provider = runtimeTargetRef.current.provider;
    if (!provider) return;
    const efforts = listEfforts(provider, model);
    const reasoningEffort =
      value.reasoningEffort && efforts.includes(value.reasoningEffort)
        ? value.reasoningEffort
        : getDefaultEffort(provider, model);
    runtimeTargetRef.current = { provider, model };
    onChange({
      model,
      reasoningEffort,
      fastMode: supportsFastMode(provider, model)
        ? (value.fastMode ?? false)
        : null,
    });
  };

  const handleFastModeChange = (fastMode: boolean): void => {
    const { provider, model } = runtimeTargetRef.current;
    onChange({
      fastMode:
        provider && model && supportsFastMode(provider, model)
          ? fastMode
          : null,
    });
  };

  return (
    <Stack spacing={2} data-testid="repository-grounding-analysis-choices">
      <Typography variant="h6">Analysis choices</Typography>
      <FormControl component="fieldset" disabled={disabled || isSubmitted}>
        <FormLabel id="repository-grounding-scope-label">
          Analysis scope
        </FormLabel>
        <RadioGroup
          aria-labelledby="repository-grounding-scope-label"
          value={value.scope ?? ""}
          onChange={(event) => {
            const scope = event.target.value;
            if (scope === "focused" || scope === "comprehensive") {
              onChange({ scope });
            }
          }}
          row
        >
          <FormControlLabel
            value="focused"
            control={<Radio />}
            label="Focused"
            data-testid="repository-grounding-scope-focused"
          />
          <FormControlLabel
            value="comprehensive"
            control={<Radio />}
            label="Comprehensive"
            data-testid="repository-grounding-scope-comprehensive"
          />
        </RadioGroup>
        <FormHelperText>
          Comprehensive analysis can start without a focus. Focused analysis
          requires a non-empty focus.
        </FormHelperText>
      </FormControl>

      {value.scope === "focused" ? (
        <TextField
          label="Analysis focus"
          value={value.focus}
          onChange={(event) => onChange({ focus: event.target.value })}
          placeholder="What should the analysis prioritize?"
          helperText="Required for focused analysis."
          multiline
          minRows={2}
          fullWidth
          required
          disabled={disabled || isSubmitted}
          error={!value.focus.trim()}
          data-testid="repository-grounding-focus"
        />
      ) : null}

      <Stack spacing={1.5} data-testid="repository-grounding-model-selection">
        <Typography variant="subtitle2">Analysis provider and model</Typography>
        {catalogSource === null && catalogState.status === "idle" ? (
          <CatalogMachineRequiredAlert testIdPrefix="repository-grounding-model-selector" />
        ) : catalogState.status === "idle" ||
          catalogState.status === "loading" ? (
          <CatalogLoadingAlert testIdPrefix="repository-grounding-model-selector" />
        ) : catalogState.status === "error" ? (
          <CatalogUnavailableAlert
            testIdPrefix="repository-grounding-model-selector"
            error={catalogState.error}
          />
        ) : catalogProvider &&
          catalogModel &&
          supportsFastMode(catalogProvider, catalogModel) &&
          value.fastMode === null ? (
          <Alert severity="error">
            The saved runtime configuration is missing its Fast mode choice.
          </Alert>
        ) : catalogProvider && catalogModel && value.fastMode !== null ? (
          <RuntimeModelSelector
            catalogSource={catalogSource}
            provider={catalogProvider}
            model={catalogModel}
            reasoningEffort={value.reasoningEffort}
            onProviderChange={handleProviderChange}
            onModelChange={handleModelChange}
            onReasoningEffortChange={(reasoningEffort) =>
              onChange({ reasoningEffort })
            }
            fastMode={value.fastMode}
            onFastModeChange={handleFastModeChange}
            testIdPrefix="repository-grounding-model-selector"
            disabled={disabled || isSubmitted}
          />
        ) : catalogProvider && catalogModel ? (
          <RuntimeModelSelector
            catalogSource={catalogSource}
            provider={catalogProvider}
            model={catalogModel}
            reasoningEffort={value.reasoningEffort}
            onProviderChange={handleProviderChange}
            onModelChange={handleModelChange}
            onReasoningEffortChange={(reasoningEffort) =>
              onChange({ reasoningEffort })
            }
            fastMode={value.fastMode ?? false}
            onFastModeChange={handleFastModeChange}
            testIdPrefix="repository-grounding-model-selector"
            disabled={disabled || isSubmitted}
          />
        ) : (
          <Alert severity="error">
            No runtime model is available for repository analysis.
          </Alert>
        )}
        <Alert severity="info" data-testid="repository-grounding-model-note">
          We recommend a frontier model for repository analysis.
        </Alert>
      </Stack>

      <Button
        variant="contained"
        type="button"
        onClick={onStart}
        disabled={disabled || isSubmitted || !validation.valid}
        aria-busy={isLaunching}
        data-testid="repository-grounding-start-analysis"
      >
        {isLaunching ? "Starting analysis…" : "Start analysis"}
      </Button>
      {!validation.valid ? (
        <FormHelperText error data-testid="repository-grounding-start-errors">
          {validation.errors.join(" ")}
        </FormHelperText>
      ) : null}
    </Stack>
  );
};

const RepositoryGroundingFieldContent = ({
  config,
  value,
  onChange,
  onSubmitValue,
  onLaunchAnalysis,
  disabled = false,
  isSubmitted = false,
  context,
  onValidityChange,
}: RepositoryGroundingFieldProps) => {
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const presentation = useMemo(
    () => readRepositoryGroundingPayload(config.payload),
    [config.payload],
  );
  const normalizedFieldValue = useMemo(
    () => normalizeRepositoryGroundingValue(value, presentation),
    [presentation, value],
  );
  const pickedMachineId = normalizedFieldValue.machineId;
  const catalogSource = useMemo(
    () =>
      pickedMachineId
        ? {
            organizationId: context.organizationId,
            projectId: context.projectId,
            machineId: pickedMachineId,
          }
        : null,
    [context.organizationId, context.projectId, pickedMachineId],
  );
  const catalogState = useRuntimeModelCatalog(catalogSource);
  const fieldValue = useMemo(
    () =>
      catalogState.status === "ready"
        ? resolveFreshRuntimeSelection(normalizedFieldValue)
        : normalizedFieldValue,
    [catalogState.status, normalizedFieldValue],
  );
  const latestFieldValueRef = useRef(fieldValue);
  latestFieldValueRef.current = fieldValue;
  const [optimisticBinding, setOptimisticBinding] = useState<{
    serviceId: string;
    machineId: string;
  } | null>(null);
  const modalService = useModalService();
  const servicesQuery = useServices(context.organizationId, {
    projectId: context.projectId,
  });
  const machinesQuery = useUserPairedMachines();
  const selectedMachine = machinesQuery.machines.find(
    (machine) => machine.machineId === fieldValue.machineId,
  );
  const liveMachineBindings = useMachineRepoBindings(fieldValue.machineId);
  const selectedService = servicesQuery.services.find(
    (service) => service.id === fieldValue.serviceId,
  );
  const selectedMachineReady =
    selectedMachine !== undefined &&
    classifyMachineExecutionReadiness(selectedMachine).selectable;
  const bindingState = getBindingState({
    serviceId: fieldValue.serviceId,
    machine: selectedMachine,
    liveBindings: liveMachineBindings,
    optimisticBinding,
  });
  const validation = useMemo(
    () =>
      getRepositoryGroundingValidation({
        value: fieldValue,
        hasReadyMachine: selectedMachineReady,
        bindingReady: bindingState === "ready",
        isRuntimeSelectionValid: ({
          provider,
          model,
          reasoningEffort,
          fastMode,
        }) => {
          if (
            !listModels(provider).some((candidate) => candidate.id === model) ||
            !listEfforts(provider, model).includes(reasoningEffort)
          ) {
            return false;
          }
          return supportsFastMode(provider, model)
            ? fastMode !== null
            : fastMode === null;
        },
      }),
    [bindingState, fieldValue, selectedMachineReady],
  );
  const fieldValidity =
    machinesQuery.isLoading || bindingState === "checking"
      ? ("loading" as const)
      : validation.valid
        ? ("valid" as const)
        : ("invalid" as const);
  useEffect(() => {
    onValidityChange?.(fieldValidity);
  }, [fieldValidity, onValidityChange]);

  const isAnalysisActive = ACTIVE_PHASES.has(fieldValue.phase);
  const hasSelectedService =
    fieldValue.entryMode === "new" || selectedService !== undefined;
  const prerequisitesReady =
    Boolean(fieldValue.serviceId) &&
    fieldValue.brief.trim().length > 0 &&
    hasSelectedService &&
    selectedMachineReady &&
    bindingState === "ready";

  const updateValue = useCallback(
    (patch: Partial<RepositoryGroundingValue>): void => {
      const nextValue = updateValueWithoutAction(
        latestFieldValueRef.current,
        patch,
      );
      latestFieldValueRef.current = nextValue;
      if (
        catalogState.status === "ready" &&
        isFreshRepositoryGroundingSetup(nextValue) &&
        ("provider" in patch ||
          "model" in patch ||
          "reasoningEffort" in patch ||
          "fastMode" in patch)
      ) {
        const selection = toSurfaceSelection(nextValue);
        if (selection) {
          writeSurfaceSelection(SERVICE_IMPORT_SURFACE_ID, selection);
        }
      }
      onChange?.(nextValue);
    },
    [catalogState.status, onChange],
  );

  const handleServiceChange = useCallback(
    (serviceId: string | null, service?: ServiceDto): void => {
      updateValue({
        serviceId,
        brief: service?.description?.trim() ?? "",
      });
    },
    [updateValue],
  );

  const handleCreateService = useCallback((): void => {
    if (!modalService) return;
    modalService.showCreateService({
      projectId: context.projectId,
      onSuccess: (service) => {
        updateValue({
          serviceId: service.id,
          brief: service.description?.trim() ?? "",
        });
        modalService.close();
      },
    });
  }, [context.projectId, modalService, updateValue]);

  const handleMachineSelect = useCallback(
    (machineId: string): void => {
      updateValue({ machineId });
    },
    [updateValue],
  );

  const handleLinked = useCallback((): void => {
    if (!fieldValue.serviceId || !fieldValue.machineId) return;
    setOptimisticBinding({
      serviceId: fieldValue.serviceId,
      machineId: fieldValue.machineId,
    });
  }, [fieldValue.machineId, fieldValue.serviceId]);

  const buildSubmission = useCallback(
    (
      action: RepositoryGroundingNextActionType,
    ): RepositoryGroundingSubmission | null => {
      if (!validation.valid) return null;
      return buildRepositoryGroundingSubmission({
        value: fieldValue,
        action,
      });
    },
    [fieldValue, validation.valid],
  );

  const launchAnalysis = useCallback(
    async (action: RepositoryGroundingNextActionType): Promise<void> => {
      const submission = buildSubmission(action);
      if (!submission) return;
      if (!onLaunchAnalysis) {
        setLaunchError("Repository analysis launch is unavailable.");
        return;
      }
      setLaunchError(null);
      setIsLaunching(true);
      try {
        await onLaunchAnalysis(submission);
      } catch (error) {
        setLaunchError(
          error instanceof Error
            ? error.message
            : "Repository analysis could not be started.",
        );
      } finally {
        setIsLaunching(false);
      }
    },
    [buildSubmission, onLaunchAnalysis],
  );

  const handleStartAnalysis = useCallback((): void => {
    void launchAnalysis(RepositoryGroundingNextAction.StartAnalysis);
  }, [launchAnalysis]);

  const submitAction = useCallback(
    (action: RepositoryGroundingNextActionType): void => {
      if (
        action === RepositoryGroundingNextAction.StartAnalysis ||
        action === RepositoryGroundingNextAction.RetryAnalysis
      ) {
        void launchAnalysis(action);
        return;
      }
      const submission = buildSubmission(action);
      if (!submission) return;
      if (onSubmitValue) {
        onSubmitValue(submission);
        return;
      }
      onChange?.(normalizeRepositoryGroundingValue(submission, presentation));
    },
    [buildSubmission, launchAnalysis, onChange, onSubmitValue, presentation],
  );

  const renderDescription = config.description ? (
    <Typography variant="body2" color="text.secondary">
      {config.description}
    </Typography>
  ) : null;

  if (isAnalysisActive) {
    return (
      <Stack
        spacing={3}
        data-testid="repository-grounding-field"
        data-field={config.field}
      >
        {renderDescription}
        {launchError ? <Alert severity="error">{launchError}</Alert> : null}
        <StatusPanel
          value={fieldValue}
          service={selectedService}
          machine={selectedMachine}
          validation={validation}
          disabled={disabled || isSubmitted || isLaunching}
          isLaunching={isLaunching}
          onAction={submitAction}
          presentation={presentation}
        />
      </Stack>
    );
  }

  return (
    <Stack
      spacing={3}
      data-testid="repository-grounding-field"
      data-field={config.field}
    >
      {renderDescription}
      {launchError ? <Alert severity="error">{launchError}</Alert> : null}
      <RepositoryGroundingPrerequisites
        context={context}
        value={fieldValue}
        selectedService={selectedService}
        selectedMachine={selectedMachine}
        selectedMachineReady={selectedMachineReady}
        bindingState={bindingState}
        servicesError={servicesQuery.error}
        machines={machinesQuery.machines}
        machinesLoading={machinesQuery.isLoading}
        machinesError={machinesQuery.error}
        canCreateService={modalService !== null}
        disabled={disabled}
        isSubmitted={isSubmitted}
        onChange={updateValue}
        onServiceChange={handleServiceChange}
        onCreateService={handleCreateService}
        onMachineSelect={handleMachineSelect}
        onLinked={handleLinked}
      />
      {prerequisitesReady ? (
        <RepositoryGroundingAnalysisChoices
          catalogSource={catalogSource}
          value={fieldValue}
          validation={validation}
          disabled={disabled || isLaunching}
          isLaunching={isLaunching}
          isSubmitted={isSubmitted}
          onChange={updateValue}
          onStart={handleStartAnalysis}
        />
      ) : (
        <Alert
          severity="info"
          data-testid="repository-grounding-analysis-locked"
        >
          Complete the repository prerequisites to choose an analysis scope and
          provider.
        </Alert>
      )}
    </Stack>
  );
};

/** Reusable repository-grounding experience for direct consumers. */
export const RepositoryGroundingField: React.FC<RepositoryGroundingFieldProps> =
  RepositoryGroundingFieldContent;

/** Semantic alias for consumers that mount the field as a complete surface. */
export const RepositoryGroundingSurface = RepositoryGroundingField;

/** Adapter used by the generic structured-form registry. */
export const RepositoryGroundingRegistryField: React.FC<
  RepositoryGroundingRegistryFieldProps
> = ({ config, value, onChange, onSubmitValue, ...props }) => {
  const presentation = readRepositoryGroundingPayload(config.payload);
  const normalizedValue = normalizeRepositoryGroundingValue(
    value,
    presentation,
  );

  return (
    <RepositoryGroundingField
      {...props}
      config={
        {
          ...config,
          payload: config.payload as
            RepositoryGroundingFieldPayload | undefined,
        } as RepositoryGroundingFieldConfig
      }
      value={normalizedValue}
      onChange={(nextValue) => onChange?.(nextValue)}
      onSubmitValue={(submission) => onSubmitValue?.(submission)}
      onLaunchAnalysis={props.context.onRepositoryGroundingLaunch}
    />
  );
};
