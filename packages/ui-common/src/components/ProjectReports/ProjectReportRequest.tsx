import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Divider,
  Grid,
  IconButton,
  Stack,
  Step,
  StepLabel,
  Stepper,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  ProjectReportKind,
  ServiceDto,
  ProjectReportPreviewRequestDto,
  ProjectReportRequestDto,
} from "../../api";
import { useServices } from "../../data/hooks/useServices";
import {
  useCreateProjectReportRequest,
  useRetryProjectReportRequest,
} from "../../data/hooks/useCreateProjectReportRequest";
import { useProjectReportPreview } from "../../data/hooks/useProjectReportPreview";
import { useProjectReportRequestStatus } from "../../data/hooks/useProjectReportRequestStatus";
import { getErrorMessage } from "../../utils/errorUtils";
import { resolveAgentBridgeRecoveryState } from "../AgentSession/agentBridgeRecoveryState";
import { RuntimeModelSelector } from "../AgentSession/RuntimeModelSelector";
import { useMachineResolution } from "../AgentSession/runtime/coding/useMachineResolution";
import {
  PROJECT_REPORT_SURFACE_ID,
  writeSurfaceSelection,
} from "../AgentSession/surfaceSelectionMemory";
import { useSurfaceSelection } from "../AgentSession/useSurfaceSelection";
import {
  ProjectReportLaunchStatus,
  ProjectReportMachineSection,
} from "./ProjectReportLaunchStatus";
import { ProjectReportQuestionFields } from "./ProjectReportQuestionFields";
import { ProjectReportScopePanel } from "./ProjectReportScopePanel";
import {
  ProjectReportSubjectPreview,
  type ProjectReportSubjectPreviewContent,
} from "./ProjectReportSubjectPreview";
import {
  buildCreateRequest,
  buildLaunchConfig,
  buildPreviewRequest,
  createProjectReportRequestState,
  describeSubmitBlocker,
  projectReportRequestReducer,
  selectExcludedPage,
  selectLaunchStatusView,
  selectNextBlocker,
  selectSubmitBlocker,
  type PreviewCounts,
  type ProjectReportAgentSelection,
  type ProjectReportRequestState,
  type ProjectReportRequestStep,
  type ProjectReportScopeContext,
  type ProjectReportScopeSelection,
} from "./projectReportRequestState";

import { useProjectReportLaunch } from "./useProjectReportLaunch";

export interface ProjectReportRequestProps {
  organizationId: string;
  projectId: string;
  currentUserId: string;
  /** IANA zone used to resolve and display period bounds. */
  timeZone: string;
  onClose?: () => void;
  /** Receives the durable request ID once the request is persisted. */
  onRequestCreated?: (requestId: string) => void;
  onOpenReport?: (reportId: string) => void;
}

const drafts = new Map<string, ProjectReportRequestState>();

const STEPS: readonly { step: ProjectReportRequestStep; label: string }[] = [
  { step: "questions", label: "Report questions" },
  { step: "scope", label: "Range and entities" },
];

const sameExceptExclusions = (
  a: ProjectReportPreviewRequestDto,
  b: ProjectReportPreviewRequestDto,
): boolean =>
  JSON.stringify({ ...a, exclusions: [] }) ===
  JSON.stringify({ ...b, exclusions: [] });

interface ProjectReportRepositoryPickerProps {
  services: readonly ServiceDto[];
  serviceIds: readonly string[];
  availableServiceIds: readonly string[];
  machineId: string | null;
  isLoading: boolean;
  error: Error | null;
  disabled: boolean;
  onChange: (serviceIds: string[]) => void;
}

interface RepositoryRowProps {
  service: ServiceDto;
  available: boolean;
  selected: boolean;
  disabled: boolean;
  machineId: string | null;
  onChange: (selected: boolean) => void;
}

const RepositoryRow = ({
  service,
  available,
  selected,
  disabled,
  machineId,
  onChange,
}: RepositoryRowProps) => (
  <Box data-testid="project-report-repository" data-service-id={service.id}>
    <FormControlLabel
      label={service.name}
      control={
        <Checkbox
          data-testid="project-report-repository-checkbox"
          checked={available && selected}
          disabled={disabled || !available}
          onChange={(_event, checked) => onChange(checked)}
        />
      }
    />
    {!available ? (
      <Typography variant="caption" color="text.secondary">
        {machineId
          ? "Not linked on the selected machine"
          : "Choose a ready machine"}
      </Typography>
    ) : null}
  </Box>
);

const ProjectReportRepositoryPicker = ({
  services,
  serviceIds,
  availableServiceIds,
  machineId,
  isLoading,
  error,
  disabled,
  onChange,
}: ProjectReportRepositoryPickerProps) => (
  <Stack spacing={1} data-testid="project-report-repositories">
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography>{serviceIds.length} selected</Typography>
      <Button
        data-testid="project-report-repositories-select-all"
        disabled={
          disabled || isLoading || error !== null || !availableServiceIds.length
        }
        onClick={() => onChange([...availableServiceIds])}
      >
        Select all
      </Button>
    </Stack>
    {error ? (
      <Alert severity="error">
        Repositories could not be loaded: {error.message}
      </Alert>
    ) : isLoading ? (
      <Typography role="status">Loading repositories…</Typography>
    ) : (
      services.map((service) => (
        <RepositoryRow
          key={service.id}
          service={service}
          available={availableServiceIds.includes(service.id)}
          selected={serviceIds.includes(service.id)}
          disabled={disabled}
          machineId={machineId}
          onChange={(selected) =>
            onChange(
              selected
                ? [...serviceIds, service.id]
                : serviceIds.filter((id) => id !== service.id),
            )
          }
        />
      ))
    )}
    <Typography variant="caption" color="text.secondary">
      Reads the latest remote default branch. Your checkout isn&apos;t changed.
    </Typography>
  </Stack>
);

export const ProjectReportRequest = ({
  organizationId,
  projectId,
  currentUserId,
  timeZone,
  onClose,
  onRequestCreated,
  onOpenReport,
}: ProjectReportRequestProps) => {
  const scopeContext: ProjectReportScopeContext = useMemo(
    () => ({ projectId, currentUserId, timeZone }),
    [projectId, currentUserId, timeZone],
  );
  const draftKey = JSON.stringify([organizationId, projectId, currentUserId]);
  const [state, dispatch] = useReducer(
    projectReportRequestReducer,
    scopeContext,
    (context) =>
      drafts.get(draftKey) ??
      createProjectReportRequestState(context, new Date(), null),
  );

  const closeRequest = () => {
    drafts.set(draftKey, state);
    onClose?.();
  };

  const openReport = onOpenReport
    ? (reportId: string) => {
        drafts.delete(draftKey);
        onOpenReport(reportId);
      }
    : undefined;

  // --- Step focus ------------------------------------------------------------
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(state.step);
  useEffect(() => {
    if (shownStep.current === state.step) return;
    shownStep.current = state.step;
    stepHeadingRef.current?.focus();
  }, [state.step]);
  const stepIndex = STEPS.findIndex(({ step }) => step === state.step);

  // --- Preview -------------------------------------------------------------
  // The preview needs no step 1 input, so it starts only once step 2 is shown.
  const previewRequest = useMemo(
    () => (state.step === "scope" ? buildPreviewRequest(state) : null),
    [state],
  );
  const preview = useProjectReportPreview(
    organizationId,
    projectId,
    previewRequest,
  );
  const counts: PreviewCounts | null = preview.data
    ? {
        matchingSubjectCount: preview.data.matchingSubjectCount,
        includedSubjectCount: preview.data.includedSubjectCount,
        excludedSubjectCount: preview.data.excludedSubjectCount,
      }
    : null;
  const content: ProjectReportSubjectPreviewContent | null = useMemo(() => {
    if (state.view === "excluded") {
      return { view: "excluded", ...selectExcludedPage(state) };
    }
    if (preview.data) {
      return {
        view: "all",
        rows: preview.data.subjects,
        total: preview.data.displayedSubjectCount,
      };
    }
    // While only exclusions changed, keep the same page's rows visible; their
    // checked state comes from local exclusions and counts stay "updating".
    const settled = preview.lastSettled;
    if (
      settled &&
      previewRequest &&
      sameExceptExclusions(settled.request, previewRequest)
    ) {
      return {
        view: "all",
        rows: settled.data.subjects,
        total: settled.data.displayedSubjectCount,
      };
    }
    return null;
  }, [state, preview.data, preview.lastSettled, previewRequest]);

  // --- Machine and agent configuration ---------------------------------------
  // Availability uses the Redis-backed machine list, matching API validation.
  const isReleaseNotes = state.kind === "RELEASE_NOTES";
  const servicesQuery = useServices(organizationId, { projectId });
  const projectServices = useMemo(
    () =>
      servicesQuery.services.filter(
        (service) =>
          service.projectId === projectId &&
          service.status !== "ARCHIVED" &&
          !service.archivedAt,
      ),
    [projectId, servicesQuery.services],
  );
  const {
    machines,
    isReady: machineInventoryReady,
    mode: machineMode,
    selectedMachine,
    setSelectedMachineId,
  } = useMachineResolution(null);
  const machinesReady =
    machineInventoryReady && !(isReleaseNotes && servicesQuery.isLoading);
  const recoveryState = useMemo(
    () =>
      resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: !machinesReady,
        machines,
        selectedMachineId: selectedMachine?.machineId ?? null,
      }),
    [machines, machinesReady, selectedMachine],
  );
  const machineId = selectedMachine?.machineId ?? null;
  const availableServiceIds = useMemo(() => {
    const bound = new Set(
      (selectedMachine?.bindings ?? []).map((binding) => binding.serviceId),
    );
    return projectServices
      .filter((service) => bound.has(service.id))
      .map((service) => service.id);
  }, [selectedMachine, projectServices]);
  useEffect(() => {
    if (
      !servicesQuery.isReady ||
      !machineInventoryReady ||
      state.submission.status === "submitted" ||
      state.submission.status === "submitting"
    )
      return;
    dispatch({ type: "reconcileRepositories", machineId, availableServiceIds });
  }, [
    machineId,
    availableServiceIds,
    servicesQuery.isReady,
    machineInventoryReady,
    state.submission.status,
  ]);
  // Browser memory seeds only a fresh request; a reopened draft keeps its own
  // choice. Nothing is chosen until the selected machine's CLI has reported
  // what it can launch.
  const catalogSource = useMemo(
    () => (machineId ? { organizationId, projectId, machineId } : null),
    [machineId, organizationId, projectId],
  );
  const { selection: catalogAgent } = useSurfaceSelection({
    surfaceId: PROJECT_REPORT_SURFACE_ID,
    catalogSource,
    resetKey: null,
  });
  useEffect(() => {
    if (state.agent === null && catalogAgent) {
      dispatch({
        type: "setAgent",
        agent: { ...catalogAgent, fastMode: catalogAgent.fastMode ?? false },
      });
    }
  }, [state.agent, catalogAgent]);
  const editAgent = useCallback(
    (patch: Partial<ProjectReportAgentSelection>) =>
      dispatch({ type: "editAgent", patch }),
    [],
  );
  // The report surface owns remembering the member's choice for fresh requests.
  const rememberedAgent = useRef(state.agent);
  useEffect(() => {
    if (rememberedAgent.current === state.agent) return;
    const seededFromCatalog = rememberedAgent.current === null;
    rememberedAgent.current = state.agent;
    // The catalog's own default is not a choice worth remembering.
    if (state.agent && !seededFromCatalog) {
      writeSurfaceSelection(PROJECT_REPORT_SURFACE_ID, state.agent);
    }
  }, [state.agent]);

  // --- Submission ----------------------------------------------------------
  const createRequest = useCreateProjectReportRequest();
  const reportLaunch = useProjectReportLaunch();
  const [createdRequest, setCreatedRequest] =
    useState<ProjectReportRequestDto | null>(null);
  const submitInFlight = useRef(false);
  // Agent edits clear the key in state; this also catches a changed machine.
  const keyLaunchFingerprint = useRef<string | null>(null);
  const requestId =
    state.submission.status === "submitted" ? state.submission.requestId : null;
  const isLocked =
    state.submission.status === "submitting" ||
    state.submission.status === "submitted";

  const repositoryInventoryBlocker =
    isReleaseNotes &&
    (!servicesQuery.isReady ||
      !machineInventoryReady ||
      state.serviceIds.some((id) => !availableServiceIds.includes(id)))
      ? { kind: "noRepositories" as const }
      : null;
  const nextBlocker =
    selectNextBlocker(state, machineId) ?? repositoryInventoryBlocker;
  const blocker =
    selectSubmitBlocker(state, {
      counts: preview.isLoading ? null : counts,
      machineId,
      hasEffort: state.agent?.reasoningEffort != null,
    }) ?? repositoryInventoryBlocker;
  const createDisabled = blocker !== null;

  const handleSubmit = async () => {
    if (blocker || submitInFlight.current || !machineId) return;
    if (!state.agent) return;
    const launch = buildLaunchConfig(state.agent, machineId);
    if (!launch) return;
    // A key identifies one exact request; changed launch settings need a new one.
    const launchFingerprint = JSON.stringify(launch);
    const idempotencyKey =
      state.idempotencyKey && keyLaunchFingerprint.current === launchFingerprint
        ? state.idempotencyKey
        : globalThis.crypto.randomUUID();
    const body = buildCreateRequest(state, launch, idempotencyKey);
    if (!body) return;
    keyLaunchFingerprint.current = launchFingerprint;
    submitInFlight.current = true;
    dispatch({ type: "submitStarted", idempotencyKey });
    try {
      const created = await createRequest.mutate({
        organizationId,
        projectId,
        request: body,
      });
      setCreatedRequest(created);
      dispatch({ type: "submitSucceeded", requestId: created.id });
      onRequestCreated?.(created.id);
      await reportLaunch.launch(created);
    } catch (error: unknown) {
      dispatch({
        type: "submitFailed",
        message: getErrorMessage(
          error,
          "The report request could not be created.",
        ),
      });
    } finally {
      submitInFlight.current = false;
    }
  };

  // --- Persisted status and retry --------------------------------------------
  const status = useProjectReportRequestStatus(
    organizationId,
    projectId,
    requestId,
    {
      initialRequest: createdRequest,
    },
  );
  const statusView = status.request
    ? selectLaunchStatusView(status.request)
    : null;
  const retry = useRetryProjectReportRequest();
  const retryKeys = useRef(new Map<string, string>());
  const [retryError, setRetryError] = useState<string | null>(null);
  const handleRetry = async () => {
    if (!requestId || statusView?.kind !== "failed" || !statusView.attemptId)
      return;
    if (retry.isPending) return;
    const attemptId = statusView.attemptId;
    // One key per failed attempt so repeated clicks cannot start two retries.
    const key =
      retryKeys.current.get(attemptId) ?? globalThis.crypto.randomUUID();
    retryKeys.current.set(attemptId, key);
    setRetryError(null);
    try {
      const next = await retry.mutate({
        organizationId,
        projectId,
        requestId,
        retry: { idempotencyKey: key, expectedAttemptId: attemptId },
      });
      status.accept(next);
      await reportLaunch.launch(next);
    } catch (error: unknown) {
      setRetryError(getErrorMessage(error, "Retry could not be started."));
    }
  };

  // --- Scope handlers ---------------------------------------------------------
  const changeScope = (selection: ProjectReportScopeSelection) =>
    dispatch({
      type: "changeScope",
      selection,
      context: scopeContext,
      now: new Date(),
    });
  const includedLabel = counts
    ? `${counts.includedSubjectCount.toLocaleString()} ${
        counts.includedSubjectCount === 1 ? "entity" : "entities"
      } included`
    : "Counting included entities…";
  const submitHint =
    blocker && blocker.kind !== "inFlight"
      ? describeSubmitBlocker(blocker)
      : "Your report will use this scope and your exclusions.";

  const cancelButton = onClose ? (
    <Button
      disabled={state.submission.status === "submitting"}
      onClick={closeRequest}
      data-testid="project-report-cancel"
      sx={{ flex: { xs: 1, sm: "none" } }}
    >
      Cancel
    </Button>
  ) : null;

  return (
    <Box
      component="section"
      aria-labelledby="project-report-request-title"
      data-testid="project-report-request"
      data-step={state.step}
      sx={{ p: { xs: 2, md: 4 } }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        sx={{ pb: 2 }}
      >
        <Box>
          <Typography variant="overline" color="primary">
            Reports
          </Typography>
          <Typography
            id="project-report-request-title"
            variant="h4"
            component="h1"
          >
            Create report
          </Typography>
        </Box>
        {onClose ? (
          <IconButton
            disabled={state.submission.status === "submitting"}
            aria-label="Close request"
            onClick={closeRequest}
            data-testid="project-report-close"
          >
            <CloseIcon />
          </IconButton>
        ) : null}
      </Stack>
      <Stepper
        activeStep={stepIndex}
        aria-label="Report request steps"
        sx={{ pb: 2 }}
        data-testid="project-report-stepper"
      >
        {STEPS.map(({ step, label }, index) => (
          <Step
            key={step}
            completed={index < stepIndex}
            aria-current={index === stepIndex ? "step" : undefined}
            data-testid="project-report-step"
            data-step={step}
          >
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      <Divider />
      <Typography
        ref={stepHeadingRef}
        tabIndex={-1}
        variant="h5"
        component="h2"
        aria-live="polite"
        sx={{ pt: 3, outline: "none" }}
        data-testid="project-report-step-heading"
      >
        Step {stepIndex + 1} of {STEPS.length}: {STEPS[stepIndex].label}
      </Typography>
      {state.step === "questions" ? (
        <>
          <Stack spacing={3} sx={{ py: 3 }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={state.kind}
              disabled={isLocked}
              aria-label="Report kind"
              data-testid="project-report-kind"
              onChange={(_event, kind: ProjectReportKind | null) => {
                if (kind) dispatch({ type: "setKind", kind });
              }}
            >
              <ToggleButton value="PROJECT_REPORT">Project report</ToggleButton>
              <ToggleButton value="RELEASE_NOTES">Release notes</ToggleButton>
            </ToggleButtonGroup>
            {isReleaseNotes ? (
              <Typography variant="body2" color="text.secondary">
                Only changes that have been merged into each project
                repository&apos;s default branch will be included.
              </Typography>
            ) : null}
            {isReleaseNotes ? (
              <ProjectReportRepositoryPicker
                services={projectServices}
                serviceIds={state.serviceIds}
                availableServiceIds={availableServiceIds}
                machineId={machineId}
                isLoading={!servicesQuery.isReady && !servicesQuery.error}
                error={servicesQuery.error}
                disabled={isLocked}
                onChange={(serviceIds) =>
                  dispatch({ type: "selectRepositories", serviceIds })
                }
              />
            ) : null}
            <ProjectReportQuestionFields
              state={state}
              disabled={isLocked}
              onApplyPreset={(preset) =>
                dispatch({ type: "applyPreset", preset })
              }
              onQuestionChange={(question) =>
                dispatch({ type: "editQuestion", question })
              }
              onOutlineChange={(outline) =>
                dispatch({ type: "editOutline", outline })
              }
            />
            <Divider />
            <Stack spacing={2} data-testid="project-report-agent">
              <Typography variant="h6" component="h3">
                Agent
              </Typography>
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={2}
                alignItems={{ md: "flex-start" }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <RuntimeModelSelector
                    testIdPrefix="project-report"
                    catalogSource={catalogSource}
                    provider={state.agent?.provider ?? null}
                    model={state.agent?.model ?? null}
                    reasoningEffort={state.agent?.reasoningEffort ?? null}
                    fastMode={state.agent?.fastMode ?? false}
                    disabled={isLocked}
                    onProviderChange={(provider) => editAgent({ provider })}
                    onModelChange={(model) => editAgent({ model })}
                    onReasoningEffortChange={(reasoningEffort) =>
                      editAgent({ reasoningEffort })
                    }
                    onFastModeChange={(fastMode) => editAgent({ fastMode })}
                  />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>
                    Runs on
                  </Typography>
                  <ProjectReportMachineSection
                    isReady={machinesReady}
                    mode={machineMode}
                    machines={machines}
                    selectedMachine={selectedMachine}
                    recoveryState={recoveryState}
                    disabled={isLocked}
                    onSelectMachine={setSelectedMachineId}
                  />
                </Box>
              </Stack>
            </Stack>
          </Stack>
          <Divider />
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", sm: "center" }}
            spacing={2}
            sx={{ pt: 3 }}
          >
            <Typography
              variant="body2"
              color="text.secondary"
              id="project-report-next-hint"
              data-testid="project-report-next-hint"
            >
              {nextBlocker
                ? describeSubmitBlocker(nextBlocker)
                : "Next, choose the range and entities to include."}
            </Typography>
            <Stack direction="row" spacing={1}>
              {cancelButton}
              <Button
                variant="contained"
                onClick={() => dispatch({ type: "next" })}
                disabled={nextBlocker !== null}
                aria-describedby="project-report-next-hint"
                data-testid="project-report-next"
                sx={{ flex: { xs: 1, sm: "none" } }}
              >
                Next
              </Button>
            </Stack>
          </Stack>
        </>
      ) : (
        <>
          <Grid container spacing={4} sx={{ py: 3 }}>
            <Grid size={{ xs: 12, md: 5 }}>
              <ProjectReportScopePanel
                state={state}
                preview={preview.data}
                isPreviewLoading={preview.isLoading}
                disabled={isLocked}
                onScopeChange={changeScope}
                onDismissScopeReset={() =>
                  dispatch({ type: "dismissScopeResetNotice" })
                }
                onRefresh={preview.refresh}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              <ProjectReportSubjectPreview
                view={state.view}
                search={state.search}
                pageSize={state.pageSize}
                offset={state.offset}
                counts={preview.isLoading ? null : counts}
                content={content}
                exclusions={state.exclusions}
                isLoading={preview.isLoading}
                error={preview.error}
                disabled={isLocked}
                onSearchChange={(search) =>
                  dispatch({ type: "setSearch", search })
                }
                onViewChange={(view) => dispatch({ type: "setView", view })}
                onPageSizeChange={(pageSize) =>
                  dispatch({ type: "setPageSize", pageSize })
                }
                onOffsetChange={(offset) =>
                  dispatch({ type: "setOffset", offset })
                }
                onToggleRow={(row) => dispatch({ type: "toggleSubject", row })}
                onRestoreSubject={(subject) =>
                  dispatch({ type: "restoreSubject", subject })
                }
                onClearExclusions={() => dispatch({ type: "clearExclusions" })}
                onRetry={preview.refresh}
              />
            </Grid>
          </Grid>
          <Divider />
          <Stack spacing={2} sx={{ pt: 3 }} data-testid="project-report-launch">
            {state.submission.status === "failed" ? (
              <Alert severity="error" data-testid="project-report-submit-error">
                {state.submission.message} Your question, agent, scope, and
                exclusions are kept; you can try again.
              </Alert>
            ) : null}
            {reportLaunch.error && statusView?.kind !== "failed" ? (
              <Alert
                severity="error"
                data-testid="project-report-launch-error"
                action={
                  <Button
                    disabled={reportLaunch.isPending}
                    onClick={() => void reportLaunch.retry()}
                    data-testid="project-report-retry-launch"
                  >
                    Retry launch
                  </Button>
                }
              >
                {reportLaunch.error}
              </Alert>
            ) : null}
            {requestId ? (
              <ProjectReportLaunchStatus
                view={statusView}
                statusError={status.error}
                isRetrying={retry.isPending}
                retryError={retryError}
                onRetry={() => void handleRetry()}
                onOpenReport={openReport}
              />
            ) : (
              <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "stretch", sm: "center" }}
                spacing={2}
              >
                <Box>
                  <Typography
                    variant="subtitle1"
                    fontWeight={600}
                    aria-live="polite"
                  >
                    {includedLabel}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    id="project-report-submit-hint"
                    data-testid="project-report-submit-hint"
                  >
                    {submitHint}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button
                    disabled={isLocked}
                    onClick={() => dispatch({ type: "back" })}
                    data-testid="project-report-back"
                    sx={{ flex: { xs: 1, sm: "none" } }}
                  >
                    Back
                  </Button>
                  {cancelButton}
                  <Button
                    variant="contained"
                    onClick={() => void handleSubmit()}
                    disabled={createDisabled}
                    aria-describedby="project-report-submit-hint"
                    data-testid="project-report-create"
                    sx={{ flex: { xs: 1, sm: "none" } }}
                  >
                    {state.submission.status === "submitting"
                      ? "Creating…"
                      : state.submission.status === "failed"
                        ? "Try again"
                        : "Create report"}
                  </Button>
                </Stack>
              </Stack>
            )}
          </Stack>
        </>
      )}
    </Box>
  );
};
