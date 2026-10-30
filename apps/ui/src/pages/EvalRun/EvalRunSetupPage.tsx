import {
  useModalState,
  ModalWorkOwner,
} from "@hey-hey/ui-common/components/Modals";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import AddIcon from "@mui/icons-material/Add";
import CancelIcon from "@mui/icons-material/Cancel";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import {
  Alert,
  Box,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography,
} from "@mui/material";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import {
  WorkStatus,
  type ConversationStartRunRequestDtoProviderEnum,
  type ConversationStartRunRequestDtoReasoningEffortEnum,
  type EvalModelSetting,
} from "@hey-hey/ui-common/api";
import {
  RuntimeModelSelector,
  listEfforts,
  listModels,
  listProviders,
  useRuntimeModelCatalog,
  type RuntimeModelCatalogSource,
} from "@hey-hey/ui-common/components";
import {
  useEvalRunSession,
  useLaunchEvalRun,
  useWorkItems,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { WebPathService } from "@hey-hey/ui-common/services";

import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import { EvalRunLayout } from "./EvalRunLayout";
import {
  EvalRunMachinePicker,
  useEvalRunMachine,
} from "./EvalRunMachinePicker";
import { RunSettingsFields } from "./RunSettingsFields";
import {
  DEFAULT_JUDGE_SETUP,
  defaultRunSettings,
  setupKey,
  toConfiguration,
  toLaunchSettings,
  type RunSettingsDraft,
} from "./evalRunView";

/** State the setup page hands the run page when the start did not go through. */
export interface EvalRunNavigationState {
  startAccepted?: boolean;
  startError?: string;
}

interface SetupChoice {
  key: string;
  setting: EvalModelSetting;
  label: string;
  selected: boolean;
}

interface DraftSelection {
  provider: ConversationStartRunRequestDtoProviderEnum | null;
  model: string | null;
  reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum | null;
}

const EMPTY_DRAFT: DraftSelection = {
  provider: null,
  model: null,
  reasoningEffort: null,
};

/**
 * A setup is usable only when the CLI's catalog offers its provider and
 * model, and its reasoning effort when the model declares efforts.
 */
const completeSetup = (
  draft: DraftSelection,
): { setting: EvalModelSetting; label: string } | null => {
  const { provider, model, reasoningEffort } = draft;
  if (!provider || !model || !listProviders().includes(provider)) return null;
  const catalogModel = listModels(provider).find((row) => row.id === model);
  if (!catalogModel) return null;
  const efforts = listEfforts(provider, model);
  if (efforts.length > 0 && !efforts.some((e) => e === reasoningEffort)) {
    return null;
  }
  if (efforts.length === 0 && reasoningEffort !== null) return null;
  const setting: EvalModelSetting = {
    provider,
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
  return {
    setting,
    label: reasoningEffort
      ? `${catalogModel.label} · ${reasoningEffort}`
      : catalogModel.label,
  };
};

interface AddConfigurationDialogProps {
  open: boolean;
  catalogSource: RuntimeModelCatalogSource | null;
  existingKeys: ReadonlySet<string>;
  onClose: () => void;
  onAdd: (setting: EvalModelSetting, label: string) => void;
}

const AddConfigurationDialog: React.FC<AddConfigurationDialogProps> = ({
  open,
  catalogSource,
  existingKeys,
  onClose,
  onAdd,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DraftSelection>(EMPTY_DRAFT);
  const catalog = useRuntimeModelCatalog(catalogSource);
  const complete = catalog.status === "ready" ? completeSetup(draft) : null;
  const isDuplicate =
    complete !== null && existingKeys.has(setupKey(complete.setting));

  const handleClose = () => {
    setDraft(EMPTY_DRAFT);
    onClose();
  };
  const handleAdd = () => {
    if (!complete || isDuplicate) return;
    onAdd(complete.setting, complete.label);
    handleClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
      data-testid="eval-run-add-configuration-dialog"
    >
      <DialogTitle>{t("eval.run.setup.dialog.title")}</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <RuntimeModelSelector
            testIdPrefix="eval-run-configuration"
            catalogSource={catalogSource}
            provider={draft.provider}
            model={draft.model}
            reasoningEffort={draft.reasoningEffort}
            fastMode={false}
            onFastModeChange={() => undefined}
            onProviderChange={(provider) =>
              setDraft((current) => ({ ...current, provider }))
            }
            onModelChange={(model) =>
              setDraft((current) => ({ ...current, model }))
            }
            onReasoningEffortChange={(reasoningEffort) =>
              setDraft((current) => ({ ...current, reasoningEffort }))
            }
          />
          {catalog.status === "ready" && !complete && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {t("eval.run.setup.dialog.incomplete")}
            </Alert>
          )}
          {isDuplicate && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {t("eval.run.setup.dialog.duplicate")}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>
          {t("eval.run.setup.dialog.cancel")}
        </Button>
        <Button
          variant="contained"
          onClick={handleAdd}
          disabled={!complete || isDuplicate}
          data-testid="eval-run-add-configuration-confirm"
        >
          {t("eval.run.setup.dialog.add")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

interface EvalRunSetupProps {
  organizationId: string;
  projectId: string;
  evalId: string;
}

const EvalRunSetup: React.FC<EvalRunSetupProps> = ({
  organizationId,
  projectId,
  evalId,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const machine = useEvalRunMachine(organizationId, projectId);
  const [setups, setSetups] = useState<SetupChoice[]>([]);
  const [isAddOpen, setIsAddOpen, isAddOpenOwnerKey] = useModalState(false);
  const [settings, setSettings] =
    useState<RunSettingsDraft>(defaultRunSettings);
  const [judgeDraft, setJudgeDraft] =
    useState<DraftSelection>(DEFAULT_JUDGE_SETUP);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // Approval is the only runnable marker, as on the Eval page.
  const {
    workItems: approvedCases,
    isLoading: isCasesLoading,
    error: casesError,
  } = useWorkItems(organizationId, "task", projectId, undefined, {
    parentTaskId: evalId,
    taskType: WORK_ITEM_TYPE_KEYS.EvalCase,
    status: WorkStatus.Active,
    enabled: !!organizationId && !!projectId,
  });

  const catalog = useRuntimeModelCatalog(machine.catalogSource);
  const judge = catalog.status === "ready" ? completeSetup(judgeDraft) : null;

  const launch = useLaunchEvalRun();
  const session = useEvalRunSession();
  const isSubmitting = launch.isPending || session.isStarting;

  const selectedSetups = useMemo(
    () => setups.filter((setup) => setup.selected),
    [setups],
  );
  const existingKeys = useMemo(
    () => new Set(setups.map((setup) => setup.key)),
    [setups],
  );
  const launchSettings = toLaunchSettings(settings);
  const attemptCount = approvedCases.length * selectedSetups.length;
  const canRun =
    !isSubmitting &&
    selectedSetups.length > 0 &&
    approvedCases.length > 0 &&
    launchSettings !== null &&
    judge !== null &&
    machine.machineId !== null;

  const handleAddSetup = useCallback(
    (setting: EvalModelSetting, label: string) => {
      setSetups((current) => [
        ...current,
        { key: setupKey(setting), setting, label, selected: true },
      ]);
    },
    [],
  );

  const handleToggleSetup = useCallback((key: string) => {
    setSetups((current) =>
      current.map((setup) =>
        setup.key === key ? { ...setup, selected: !setup.selected } : setup,
      ),
    );
  }, []);

  const handleRemoveSetup = useCallback((key: string) => {
    setSetups((current) => current.filter((setup) => setup.key !== key));
  }, []);

  const handleRun = useCallback(async () => {
    if (!canRun || !launchSettings || !judge) return;
    setLaunchError(null);
    let runId: string;
    try {
      const run = await launch.mutate({
        organizationId,
        projectId,
        evalId,
        request: {
          evalCaseIds: approvedCases.map((evalCase) => evalCase.id),
          configurations: selectedSetups.map((setup) =>
            toConfiguration(
              setup.setting,
              settings.projectAssistantEnabled,
              settings.handler,
            ),
          ),
          judgeSetup: judge.setting,
          settings: launchSettings,
        },
      });
      runId = run.id;
    } catch (caught) {
      setLaunchError(caught instanceof Error ? caught.message : String(caught));
      return;
    }
    // The run is recorded; it starts from what the server saved, and a start
    // that does not go through stays retryable on the run's own page.
    const started = await session.start({
      organizationId,
      projectId,
      runId,
      machineId: machine.machineId,
    });
    const state: EvalRunNavigationState = started.ok
      ? { startAccepted: true }
      : { startError: started.error };
    navigate(WebPathService.evalRun({ projectId, evalId, runId }), { state });
  }, [
    approvedCases,
    canRun,
    evalId,
    judge,
    launch,
    launchSettings,
    machine.machineId,
    navigate,
    organizationId,
    projectId,
    selectedSetups,
    session,
    settings.handler,
    settings.projectAssistantEnabled,
  ]);

  const casesLabel = t("eval.run.cases", { count: approvedCases.length });
  const configurationsLabel = t("eval.run.configurations", {
    count: selectedSetups.length,
  });
  const attemptsLabel = t("eval.run.attempts", { count: attemptCount });

  return (
    <>
      <Typography variant="h5" component="h1" sx={{ mb: 3 }}>
        {t("eval.run.setup.title")}
      </Typography>

      <Box data-testid="eval-run-config-picker">
        <Typography variant="subtitle1" component="h2" sx={{ mb: 1 }}>
          {t("eval.run.setup.configurations")}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          {setups.map((setup) => (
            <Chip
              key={setup.key}
              label={setup.label}
              color={setup.selected ? "primary" : "default"}
              variant={setup.selected ? "filled" : "outlined"}
              onClick={() => handleToggleSetup(setup.key)}
              onDelete={() => handleRemoveSetup(setup.key)}
              disabled={isSubmitting}
              role="checkbox"
              aria-checked={setup.selected}
              deleteIcon={
                <CancelIcon
                  aria-label={t("eval.run.setup.removeConfiguration", {
                    setup: setup.label,
                  })}
                />
              }
              data-testid={`eval-run-config-option-${setup.key}`}
            />
          ))}
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setIsAddOpen(true)}
            disabled={isSubmitting}
            data-testid="eval-run-add-configuration"
          >
            {t("eval.run.setup.addConfiguration")}
          </Button>
        </Box>
        {setups.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("eval.run.setup.noConfigurations")}
          </Typography>
        )}
      </Box>

      <Box sx={{ mt: 3 }} data-testid="eval-run-judge">
        <Typography variant="subtitle1" component="h2" sx={{ mb: 0.5 }}>
          {t("eval.run.setup.judge")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t("eval.run.setup.judgeHint")}
        </Typography>
        <RuntimeModelSelector
          testIdPrefix="eval-run-judge"
          catalogSource={machine.catalogSource}
          provider={judgeDraft.provider}
          model={judgeDraft.model}
          reasoningEffort={judgeDraft.reasoningEffort}
          fastMode={false}
          onFastModeChange={() => undefined}
          onProviderChange={(provider) =>
            setJudgeDraft((current) => ({ ...current, provider }))
          }
          onModelChange={(model) =>
            setJudgeDraft((current) => ({ ...current, model }))
          }
          onReasoningEffortChange={(reasoningEffort) =>
            setJudgeDraft((current) => ({ ...current, reasoningEffort }))
          }
        />
        {catalog.status === "ready" && !judge && (
          <Alert
            severity="info"
            sx={{ mt: 1 }}
            data-testid="eval-run-judge-incomplete"
          >
            {t("eval.run.setup.judgeIncomplete")}
          </Alert>
        )}
      </Box>

      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle1" component="h2" sx={{ mb: 1 }}>
          {t("eval.run.setup.cases")}
        </Typography>
        {casesError ? (
          <Alert severity="error">{t("eval.run.setup.casesError")}</Alert>
        ) : approvedCases.length === 0 && !isCasesLoading ? (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="eval-run-cases-empty"
          >
            {t("eval.run.setup.noCases")}
          </Typography>
        ) : (
          <Box component="ul" data-testid="eval-run-cases" sx={{ m: 0, pl: 3 }}>
            {approvedCases.map((evalCase) => (
              <li key={evalCase.id}>
                <Typography variant="body2">{evalCase.name}</Typography>
              </li>
            ))}
          </Box>
        )}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 1 }}
          data-testid="eval-run-attempt-count"
        >
          {t("eval.run.setup.attemptCount", {
            cases: casesLabel,
            configurations: configurationsLabel,
            attempts: attemptsLabel,
          })}
        </Typography>
      </Box>

      <Divider sx={{ my: 3 }} />
      <RunSettingsFields
        value={settings}
        disabled={isSubmitting}
        onChange={setSettings}
      />

      <Divider sx={{ my: 3 }} />
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: 3,
          alignItems: "flex-end",
          justifyContent: "space-between",
        }}
      >
        <Box sx={{ flex: 1, minWidth: 280, maxWidth: 820 }}>
          <Alert
            severity="info"
            icon={false}
            sx={{ mb: 1 }}
            data-testid="eval-run-live-project-note"
          >
            {t("eval.run.setup.liveProjectNote")}
          </Alert>
          <Alert
            severity="info"
            icon={false}
            sx={{ mb: 2 }}
            data-testid="eval-run-inert-output-note"
          >
            {t("eval.run.setup.inertOutputNote")}
          </Alert>
          <EvalRunMachinePicker machine={machine} testIdPrefix="eval-run" />
        </Box>
        <Button
          variant="contained"
          size="large"
          startIcon={<PlayArrowIcon />}
          onClick={handleRun}
          disabled={!canRun}
          data-testid="eval-run-start"
        >
          {t("eval.run.setup.run")}
        </Button>
      </Box>
      {launchError && (
        <Alert
          severity="error"
          sx={{ mt: 2 }}
          data-testid="eval-run-launch-error"
        >
          {t("eval.run.setup.launchError", { message: launchError })}
        </Alert>
      )}

      <ModalWorkOwner.Provider value={isAddOpenOwnerKey}>
        <AddConfigurationDialog
          open={isAddOpen}
          catalogSource={machine.catalogSource}
          existingKeys={existingKeys}
          onClose={() => setIsAddOpen(false)}
          onAdd={handleAddSetup}
        />
      </ModalWorkOwner.Provider>
    </>
  );
};

export const EvalRunSetupPage: React.FC = () => {
  const { t } = useTranslation();
  const identity = useUserIdentity();
  const { projectId = "", evalId = "" } = useParams<{
    projectId?: string;
    evalId?: string;
  }>();
  const organizationId = identity?.currentOrgId?.trim() ?? "";

  if (!organizationId || !projectId || !evalId) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {t("eval.run.missingContext")}
      </Alert>
    );
  }

  return (
    <EvalRunLayout
      organizationId={organizationId}
      projectId={projectId}
      evalId={evalId}
      crumbLabel={t("eval.run.setup.crumb")}
      testId="eval-run-setup-page"
    >
      {() => (
        <EvalRunSetup
          organizationId={organizationId}
          projectId={projectId}
          evalId={evalId}
        />
      )}
    </EvalRunLayout>
  );
};
