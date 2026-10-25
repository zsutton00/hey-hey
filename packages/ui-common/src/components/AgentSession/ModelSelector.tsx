import { useModalState } from "../Modals/useModalState";
import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  type SelectChangeEvent,
} from "@mui/material";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from "react";
import {
  ClaudeCodeIcon,
  CodexIcon,
  OpencodeIcon,
  type ProviderIconProps,
} from "../Activity/providerIcons.js";
import {
  ConversationStartRunRequestDtoProviderEnum,
  type ConversationStartRunRequestDtoReasoningEffortEnum,
} from "../../api";
import {
  listEfforts,
  listModels,
  listProviders,
  supportsFastMode,
} from "./capabilityCatalog";
import {
  modelSelectionConfigurationsEqual,
  type FavoriteMutationResult,
  type ModelSelectionConfiguration,
  type ModelSelectionFavorite,
  type ModelSelectionFavoriteId,
} from "./modelSelectionFavorites";
import type { MachineDto } from "../../api";
import { AgentBridgeRecoveryNotice } from "./AgentBridgeRecoveryNotice";
import type { AgentBridgeRecoveryState } from "./agentBridgeRecoveryState";
import { MachinePicker } from "./MachinePicker";
import type { MachineResolutionMode } from "./runtime/coding/useMachineResolution";
import { getMachineExecutionLabel } from "./runtime/coding/machineExecutionReadiness";

interface ProviderVisual {
  Icon: FC<ProviderIconProps>;
  label: string;
}

const PROVIDER_VISUALS: Record<
  ConversationStartRunRequestDtoProviderEnum,
  ProviderVisual
> = {
  [ConversationStartRunRequestDtoProviderEnum.Claude]: {
    Icon: ClaudeCodeIcon,
    label: "Claude Code",
  },
  [ConversationStartRunRequestDtoProviderEnum.Codex]: {
    Icon: CodexIcon,
    label: "Codex",
  },
  [ConversationStartRunRequestDtoProviderEnum.Opencode]: {
    Icon: OpencodeIcon,
    label: "Opencode",
  },
};

const EFFORT_LABELS: Record<
  ConversationStartRunRequestDtoReasoningEffortEnum,
  string
> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
  default: "Default",
};

const ProviderOptionContent = ({
  provider,
}: {
  provider: ConversationStartRunRequestDtoProviderEnum;
}) => {
  const { Icon, label } = PROVIDER_VISUALS[provider];
  return (
    <Stack direction="row" spacing={1} alignItems="center" component="span">
      <Box
        component="span"
        aria-hidden="true"
        sx={{ display: "inline-flex", fontSize: 18, lineHeight: 0 }}
      >
        <Icon size="1em" />
      </Box>
      <span>{label}</span>
    </Stack>
  );
};

interface ModelSelectorBaseProps {
  provider: ConversationStartRunRequestDtoProviderEnum;
  model: string;
  reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum | null;
  onProviderChange: (
    provider: ConversationStartRunRequestDtoProviderEnum,
  ) => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (
    effort: ConversationStartRunRequestDtoReasoningEffortEnum | null,
  ) => void;
  testIdPrefix?: string;
  disabled?: boolean;
  machineSelection?: ModelSelectorMachineSelectionProps;
  /** Control placed at the end of the selector row, e.g. a machine picker. */
  rowEnd?: ReactNode;
}

export interface ModelSelectorMachineSelectionProps {
  machines: MachineDto[];
  machineMode: MachineResolutionMode;
  selectedMachineId: string | null;
  onSelectMachine: (machineId: string) => void;
  recoveryState: AgentBridgeRecoveryState;
}

export const ModelSelectorMachineSelection = ({
  testIdPrefix,
  machineSelection,
  mobileMode = "summary",
}: {
  testIdPrefix: string;
  machineSelection?: ModelSelectorMachineSelectionProps;
  mobileMode?: "summary" | "editor";
}) => {
  if (!machineSelection) return null;

  const hasResolvedSoleMachine =
    machineSelection.machineMode === "one" &&
    machineSelection.selectedMachineId !== null;
  const showMachinePicker =
    machineSelection.machines.length > 0 && !hasResolvedSoleMachine;

  return (
    <Stack spacing={1.5} data-testid={`${testIdPrefix}-machine-selection`}>
      {showMachinePicker ? (
        <MachinePicker
          machines={machineSelection.machines}
          selectedMachineId={machineSelection.selectedMachineId}
          onSelect={machineSelection.onSelectMachine}
          mobileMode={mobileMode}
        />
      ) : (
        <AgentBridgeRecoveryNotice
          state={machineSelection.recoveryState}
          presentation="inline"
          testId={`${testIdPrefix}-machine-readiness-notice`}
        />
      )}
    </Stack>
  );
};

export interface ModelSelectorFavoriteProps {
  favorites: readonly ModelSelectionFavorite[];
  onSaveFavorite: (
    name: string,
    configuration: ModelSelectionConfiguration,
  ) => FavoriteMutationResult;
  onApplyFavorite: (favorite: ModelSelectionFavorite) => void;
  onRenameFavorite: (
    id: ModelSelectionFavoriteId,
    name: string,
  ) => FavoriteMutationResult;
  onDeleteFavorite: (id: ModelSelectionFavoriteId) => void;
}

interface ModelSelectorFastModeProps {
  fastMode: boolean;
  onFastModeChange: (fastMode: boolean) => void;
}

export type ModelSelectorProps = ModelSelectorBaseProps &
  ModelSelectorFastModeProps &
  ModelSelectorFavoriteProps;

type FavoriteDialogState =
  | { kind: "closed" }
  | { kind: "save" }
  | { kind: "rename"; favorite: ModelSelectionFavorite };

const MANAGE_FAVORITES_VALUE = "manage-favorites";
const ROW_END_MIN_WIDTH = 180;

const SummarySeparator = () => (
  <Box component="span" aria-hidden="true" sx={{ px: 0.75 }}>
    ·
  </Box>
);

type CapabilityModel = ReturnType<typeof listModels>[number];
type CapabilityEffort = ReturnType<typeof listEfforts>[number];

interface ModelSelectorControlsProps {
  provider: ConversationStartRunRequestDtoProviderEnum;
  model: string;
  reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum | null;
  onProviderChange: (
    event: SelectChangeEvent<ConversationStartRunRequestDtoProviderEnum>,
  ) => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (
    event: SelectChangeEvent<ConversationStartRunRequestDtoReasoningEffortEnum>,
  ) => void;
  providers: readonly ConversationStartRunRequestDtoProviderEnum[];
  models: readonly CapabilityModel[];
  efforts: readonly CapabilityEffort[];
  favorites: readonly ModelSelectionFavorite[];
  selectedFavorite: ModelSelectionFavorite | undefined;
  onFavoriteChange: (event: SelectChangeEvent<string>) => void;
  onOpenFavoriteSave: () => void;
  testIdPrefix: string;
  disabled: boolean;
  direction?: "row" | "column";
  rowEnd?: ReactNode;
}

const ModelSelectorControls = ({
  provider,
  model,
  reasoningEffort,
  onProviderChange,
  onModelChange,
  onReasoningEffortChange,
  providers,
  models,
  efforts,
  favorites,
  selectedFavorite,
  onFavoriteChange,
  onOpenFavoriteSave,
  testIdPrefix,
  disabled,
  direction,
  rowEnd,
}: ModelSelectorControlsProps) => {
  const providerLabelId = `${testIdPrefix}-provider-label`;
  const favoriteLabelId = `${testIdPrefix}-favorite-label`;
  const effortLabelId = `${testIdPrefix}-effort-label`;

  return (
    <Stack
      direction={direction ?? { xs: "column", sm: "row" }}
      spacing={2}
      data-testid={`${testIdPrefix}-controls`}
    >
      <FormControl
        size="small"
        sx={{ minWidth: 160, width: { xs: "100%", sm: "auto" } }}
        disabled={disabled}
      >
        <InputLabel id={providerLabelId}>Provider</InputLabel>
        <Select<ConversationStartRunRequestDtoProviderEnum>
          labelId={providerLabelId}
          value={provider}
          label="Provider"
          onChange={onProviderChange}
          disabled={disabled}
          data-testid={`${testIdPrefix}-provider-select`}
          renderValue={(selected) => (
            <ProviderOptionContent provider={selected} />
          )}
        >
          {providers.map((option) => (
            <MenuItem
              key={option}
              value={option}
              data-testid={`${testIdPrefix}-provider-option-${option}`}
            >
              <ProviderOptionContent provider={option} />
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl
        size="small"
        sx={{ minWidth: 130, width: { xs: "100%", sm: "auto" } }}
        disabled={disabled}
      >
        <InputLabel id={favoriteLabelId} shrink>
          Favorite
        </InputLabel>
        <Select<string>
          labelId={favoriteLabelId}
          value={selectedFavorite?.id ?? ""}
          displayEmpty
          label="Favorite"
          onChange={onFavoriteChange}
          disabled={disabled}
          data-testid={`${testIdPrefix}-favorite-select`}
          renderValue={(value) =>
            favorites.find((favorite) => favorite.id === value)?.name ??
            "Custom"
          }
        >
          <MenuItem value="" disabled>
            Custom
          </MenuItem>
          {favorites.map((favorite) => (
            <MenuItem
              key={favorite.id}
              value={favorite.id}
              data-testid={`${testIdPrefix}-favorite-option`}
              data-favorite-id={favorite.id}
            >
              {favorite.name}
            </MenuItem>
          ))}
          {favorites.length > 0 ? (
            <MenuItem
              value={MANAGE_FAVORITES_VALUE}
              data-testid={`${testIdPrefix}-favorite-manage`}
              sx={{ borderTop: 1, borderColor: "divider" }}
            >
              Manage favorites…
            </MenuItem>
          ) : null}
        </Select>
      </FormControl>

      <Box sx={{ minWidth: 160, width: { xs: "100%", sm: "auto" } }}>
        <Autocomplete<CapabilityModel, false, true, false>
          disableClearable
          options={models}
          value={models.find((option) => option.id === model)!}
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          onChange={(_, option) => onModelChange(option.id)}
          disabled={disabled}
          fullWidth
          data-testid={`${testIdPrefix}-model-select`}
          renderInput={(params) => (
            <TextField
              {...params}
              id={`${testIdPrefix}-model`}
              label="Model"
              size="small"
              slotProps={{
                htmlInput: {
                  ...params.inputProps,
                  "data-testid": `${testIdPrefix}-model-input`,
                },
              }}
            />
          )}
          renderOption={(props, option) => {
            const { key, ...optionProps } = props;
            return (
              <li
                key={key}
                {...optionProps}
                data-testid={`${testIdPrefix}-model-option-${option.id}`}
              >
                {option.label}
              </li>
            );
          }}
        />
      </Box>

      {efforts.length > 0 ? (
        <FormControl
          size="small"
          sx={{ minWidth: 110, width: { xs: "100%", sm: "auto" } }}
          disabled={disabled}
        >
          <InputLabel id={effortLabelId}>Effort</InputLabel>
          <Select<ConversationStartRunRequestDtoReasoningEffortEnum>
            labelId={effortLabelId}
            value={reasoningEffort ?? ""}
            label="Effort"
            onChange={onReasoningEffortChange}
            disabled={disabled}
            data-testid={`${testIdPrefix}-effort-select`}
          >
            {efforts.map((option) => (
              <MenuItem
                key={option}
                value={option}
                data-testid={`${testIdPrefix}-effort-option-${option}`}
              >
                {EFFORT_LABELS[option]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      ) : null}

      <Box
        sx={{
          width: 40,
          height: 40,
          flex: "0 0 40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        data-testid={`${testIdPrefix}-favorite-save-slot`}
      >
        {!selectedFavorite ? (
          <Tooltip title="Save as favorite">
            <span>
              <IconButton
                size="small"
                color="primary"
                onClick={onOpenFavoriteSave}
                disabled={disabled}
                aria-label="Save as favorite"
                data-testid={`${testIdPrefix}-favorite-save`}
              >
                <SaveOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
      </Box>
      {rowEnd ? (
        <Box
          sx={{ minWidth: ROW_END_MIN_WIDTH, flex: { sm: 1 } }}
          data-testid={`${testIdPrefix}-row-end`}
        >
          {rowEnd}
        </Box>
      ) : null}
    </Stack>
  );
};

interface ModelSelectorEditorProps extends ModelSelectorControlsProps {
  fastMode: boolean;
  fastModeSupported: boolean;
  onFastModeChange: (fastMode: boolean) => void;
  machineSelection?: ModelSelectorMachineSelectionProps;
}

const ModelSelectorEditor = ({
  fastMode,
  fastModeSupported,
  onFastModeChange,
  machineSelection,
  ...controlsProps
}: ModelSelectorEditorProps) => (
  <Stack spacing={1}>
    <ModelSelectorControls {...controlsProps} />
    {fastModeSupported ? (
      <FormControlLabel
        sx={{ m: 0, minHeight: 40 }}
        control={
          <Switch
            checked={fastMode === true}
            onChange={(event) => onFastModeChange(event.target.checked)}
            disabled={controlsProps.disabled}
            slotProps={{ input: { "aria-label": "Fast mode" } }}
            data-testid={`${controlsProps.testIdPrefix}-fast-mode-switch`}
          />
        }
        label="Fast mode"
      />
    ) : null}
    <ModelSelectorMachineSelection
      testIdPrefix={controlsProps.testIdPrefix}
      machineSelection={machineSelection}
      mobileMode="editor"
    />
  </Stack>
);

interface ModelSelectionSummaryProps {
  provider: ConversationStartRunRequestDtoProviderEnum;
  model: string;
  effort: string | null;
  fastMode: boolean | undefined;
  fastModeSupported: boolean;
  machine: string | null;
  testIdPrefix: string;
  disabled: boolean;
  ariaLabel: string;
  onEdit: () => void;
  mode: "chips" | "minimal";
}

const ModelSelectionSummary = ({
  provider,
  model,
  effort,
  fastMode,
  fastModeSupported,
  machine,
  testIdPrefix,
  disabled,
  ariaLabel,
  onEdit,
  mode,
}: ModelSelectionSummaryProps) => {
  const { Icon } = PROVIDER_VISUALS[provider];

  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{
        width: mode === "chips" ? "max-content" : "100%",
        minWidth: 0,
      }}
      data-testid={`${testIdPrefix}-${mode}-summary`}
    >
      <Typography
        component="span"
        variant="body2"
        aria-label={ariaLabel}
        sx={{
          minWidth: 0,
          flex: mode === "minimal" ? 1 : undefined,
          whiteSpace: mode === "chips" ? "nowrap" : "normal",
          overflowWrap: mode === "minimal" ? "anywhere" : undefined,
        }}
      >
        <Box
          component="span"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            verticalAlign: "middle",
            mr: 0.75,
          }}
        >
          <Icon size="1em" />
        </Box>
        <Box component="span">{model}</Box>
        {mode === "chips" && effort ? (
          <>
            <SummarySeparator />
            <Box component="span">{effort}</Box>
          </>
        ) : null}
        {mode === "chips" && fastModeSupported ? (
          <>
            <SummarySeparator />
            <Box component="span">Fast {fastMode === true ? "on" : "off"}</Box>
          </>
        ) : null}
        {mode === "chips" && machine ? (
          <>
            <SummarySeparator />
            <Box component="span">{machine}</Box>
          </>
        ) : null}
      </Typography>
      <Button
        size="small"
        startIcon={<EditOutlinedIcon />}
        onClick={onEdit}
        disabled={disabled}
        data-testid={`${testIdPrefix}-${mode}-edit`}
      >
        Edit
      </Button>
    </Stack>
  );
};

export type ModelSelectorPresentation = "full" | "chips" | "minimal";

export const selectModelSelectorPresentation = ({
  availableWidth,
  fullWidth,
  chipsWidth,
}: {
  availableWidth: number;
  fullWidth: number;
  chipsWidth: number;
}): ModelSelectorPresentation => {
  if (fullWidth <= availableWidth) return "full";
  if (chipsWidth <= availableWidth) return "chips";
  return "minimal";
};

export const ModelSelector = ({
  provider,
  model,
  reasoningEffort,
  onProviderChange,
  onModelChange,
  onReasoningEffortChange,
  fastMode,
  onFastModeChange,
  favorites,
  onSaveFavorite,
  onApplyFavorite,
  onRenameFavorite,
  onDeleteFavorite,
  testIdPrefix = "model-selector",
  disabled = false,
  machineSelection,
  rowEnd,
}: ModelSelectorProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fullMeasureRef = useRef<HTMLDivElement | null>(null);
  const chipsMeasureRef = useRef<HTMLDivElement | null>(null);
  const [presentation, setPresentation] =
    useState<ModelSelectorPresentation>("minimal");
  const [favoriteDialog, setFavoriteDialog] = useState<FavoriteDialogState>({
    kind: "closed",
  });
  const [favoriteName, setFavoriteName] = useState("");
  const [favoriteNameError, setFavoriteNameError] = useState<string | null>(
    null,
  );
  const [preferredFavoriteId, setPreferredFavoriteId] =
    useState<ModelSelectionFavoriteId | null>(null);
  const [
    manageFavoritesOpen,
    setManageFavoritesOpen,
    manageFavoritesOpenOwnerKey,
  ] = useModalState(false);
  const [editorOpen, setEditorOpen, editorOpenOwnerKey] = useModalState(false);
  // A provider that reported zero models is explained by the CLI's notice
  // (shown by RuntimeModelSelector); it is not something to pick.
  const providers = listProviders().filter(
    (candidate) => listModels(candidate).length > 0,
  );
  const models = listModels(provider);
  const efforts = listEfforts(provider, model);
  const selectionSupportsFastMode = supportsFastMode(provider, model);
  const hasCompleteSelection =
    models.some((option) => option.id === model) &&
    (efforts.length === 0
      ? reasoningEffort === null
      : reasoningEffort !== null && efforts.includes(reasoningEffort));
  const fastModeSupported = selectionSupportsFastMode;
  const configuration = useMemo<ModelSelectionConfiguration>(
    () => ({
      provider,
      model,
      reasoningEffort,
      ...(fastMode === true ? { serviceTier: "priority" } : {}),
    }),
    [provider, model, reasoningEffort, fastMode],
  );
  const matchingFavorites = favorites.filter((favorite) =>
    modelSelectionConfigurationsEqual(favorite, configuration),
  );
  const selectedFavorite =
    matchingFavorites.find((favorite) => favorite.id === preferredFavoriteId) ??
    matchingFavorites[0];
  const selectedModel = models.find((option) => option.id === model);
  const displayModel = selectedModel?.label ?? "Model unavailable";
  const displayEffort = reasoningEffort ? EFFORT_LABELS[reasoningEffort] : null;
  const selectedMachine = machineSelection?.machines.find(
    (candidate) => candidate.machineId === machineSelection.selectedMachineId,
  );
  const displayMachine = machineSelection
    ? selectedMachine
      ? getMachineExecutionLabel(selectedMachine)
      : machineSelection.machines.length > 0
        ? "No machine selected"
        : "No machine available"
    : null;
  const mobileSummaryLabel = [
    PROVIDER_VISUALS[provider].label,
    displayModel,
    ...(displayEffort ? [displayEffort] : []),
    ...(fastModeSupported
      ? [`Fast mode ${fastMode === true ? "on" : "off"}`]
      : []),
    ...(displayMachine ? [displayMachine] : []),
  ].join(", ");

  const updatePresentation = useCallback(() => {
    const container = containerRef.current;
    const fullMeasure = fullMeasureRef.current;
    const chipsMeasure = chipsMeasureRef.current;
    if (!container || !fullMeasure || !chipsMeasure) return;

    setPresentation(
      selectModelSelectorPresentation({
        availableWidth: container.clientWidth,
        fullWidth: fullMeasure.scrollWidth,
        chipsWidth: chipsMeasure.scrollWidth,
      }),
    );
  }, []);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      setPresentation("full");
      return;
    }
    const observer = new ResizeObserver(updatePresentation);
    const elements = [
      containerRef.current,
      fullMeasureRef.current,
      chipsMeasureRef.current,
    ].filter((element): element is HTMLDivElement => element !== null);
    elements.forEach((element) => observer.observe(element));
    updatePresentation();
    return () => observer.disconnect();
  }, [updatePresentation]);

  const openFavoriteDialog = (
    state: Exclude<FavoriteDialogState, { kind: "closed" }>,
  ) => {
    setFavoriteDialog(state);
    setFavoriteName(state.kind === "rename" ? state.favorite.name : "");
    setFavoriteNameError(null);
  };

  const closeFavoriteDialog = () => {
    setFavoriteDialog({ kind: "closed" });
    setFavoriteNameError(null);
  };

  const submitFavoriteDialog = () => {
    const result =
      favoriteDialog.kind === "rename"
        ? onRenameFavorite(favoriteDialog.favorite.id, favoriteName)
        : onSaveFavorite(favoriteName, configuration);
    if (result.ok) {
      closeFavoriteDialog();
      return;
    }
    setFavoriteNameError(
      result.reason === "required-name"
        ? "Favorite name is required."
        : "A favorite with this name already exists.",
    );
  };

  const handleProviderChange = (
    event: SelectChangeEvent<ConversationStartRunRequestDtoProviderEnum>,
  ) => {
    const newProvider = event.target
      .value as ConversationStartRunRequestDtoProviderEnum;
    if (newProvider === provider) {
      return;
    }
    const newModels = listModels(newProvider);
    const firstModel = newModels[0];
    if (!firstModel) {
      return;
    }
    onProviderChange(newProvider);
    onModelChange(firstModel.id);
    const newEfforts = listEfforts(newProvider, firstModel.id);
    if (reasoningEffort === null || !newEfforts.includes(reasoningEffort)) {
      onReasoningEffortChange(newEfforts.length > 0 ? newEfforts[0] : null);
    }
    if (fastMode === true && !supportsFastMode(newProvider, firstModel.id)) {
      onFastModeChange(false);
    }
  };

  const handleModelChange = (newModel: string) => {
    if (newModel === model) {
      return;
    }
    onModelChange(newModel);
    const newEfforts = listEfforts(provider, newModel);
    if (reasoningEffort === null || !newEfforts.includes(reasoningEffort)) {
      onReasoningEffortChange(newEfforts.length > 0 ? newEfforts[0] : null);
    }
    if (fastMode === true && !supportsFastMode(provider, newModel)) {
      onFastModeChange(false);
    }
  };

  const handleEffortChange = (
    event: SelectChangeEvent<ConversationStartRunRequestDtoReasoningEffortEnum>,
  ) => {
    onReasoningEffortChange(
      event.target.value as ConversationStartRunRequestDtoReasoningEffortEnum,
    );
  };

  const handleFavoriteChange = (event: SelectChangeEvent<string>) => {
    if (event.target.value === MANAGE_FAVORITES_VALUE) {
      setManageFavoritesOpen(true);
      return;
    }
    const favorite = favorites.find(
      (candidate) => candidate.id === event.target.value,
    );
    if (favorite) {
      setPreferredFavoriteId(favorite.id);
      onApplyFavorite(favorite);
    }
  };

  const buildEditor = (
    prefix: string,
    direction?: "row" | "column",
    includeMachine = true,
    rowEndContent: ReactNode = undefined,
  ) => (
    <ModelSelectorEditor
      provider={provider}
      model={model}
      reasoningEffort={reasoningEffort}
      onProviderChange={handleProviderChange}
      onModelChange={handleModelChange}
      onReasoningEffortChange={handleEffortChange}
      providers={providers}
      models={models}
      efforts={efforts}
      favorites={favorites}
      selectedFavorite={selectedFavorite}
      onFavoriteChange={handleFavoriteChange}
      onOpenFavoriteSave={() => openFavoriteDialog({ kind: "save" })}
      testIdPrefix={prefix}
      disabled={disabled}
      fastMode={fastMode}
      fastModeSupported={fastModeSupported}
      onFastModeChange={onFastModeChange}
      machineSelection={includeMachine ? machineSelection : undefined}
      direction={direction}
      rowEnd={rowEndContent}
    />
  );
  if (!hasCompleteSelection) {
    return (
      <Stack spacing={1} data-testid={`${testIdPrefix}-selection-unavailable`}>
        <Alert severity="error">
          The selected provider, model, or reasoning effort is not available in
          the runtime model catalog.
        </Alert>
        <ModelSelectorMachineSelection
          testIdPrefix={testIdPrefix}
          machineSelection={machineSelection}
        />
        {rowEnd}
      </Stack>
    );
  }
  const editor = buildEditor(testIdPrefix, undefined, true, rowEnd);
  const rowEndBelow = presentation === "full" ? null : rowEnd;
  const buildChipsSummary = (prefix: string) => (
    <ModelSelectionSummary
      provider={provider}
      model={displayModel}
      effort={displayEffort}
      fastMode={fastMode}
      fastModeSupported={fastModeSupported}
      machine={displayMachine}
      testIdPrefix={prefix}
      disabled={disabled}
      ariaLabel={mobileSummaryLabel}
      onEdit={() => setEditorOpen(true)}
      mode="chips"
    />
  );
  const chipsSummary = buildChipsSummary(testIdPrefix);
  return (
    <Stack
      ref={containerRef}
      spacing={1}
      sx={{
        minWidth: 0,
        width: "100%",
        maxWidth: "100%",
        position: "relative",
      }}
      data-testid={`${testIdPrefix}-root`}
      data-presentation={presentation}
    >
      <Box
        ref={fullMeasureRef}
        aria-hidden="true"
        data-testid={`${testIdPrefix}-full-measure`}
        sx={{
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          width: "max-content",
        }}
      >
        {buildEditor(
          `${testIdPrefix}-measure-full`,
          "row",
          false,
          rowEnd ? <Box sx={{ width: ROW_END_MIN_WIDTH }} /> : undefined,
        )}
      </Box>
      <Box
        ref={chipsMeasureRef}
        aria-hidden="true"
        data-testid={`${testIdPrefix}-chips-measure`}
        sx={{
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          width: "max-content",
        }}
      >
        {buildChipsSummary(`${testIdPrefix}-measure-chips`)}
      </Box>

      {presentation === "full" ? (
        editor
      ) : presentation === "chips" ? (
        chipsSummary
      ) : (
        <ModelSelectionSummary
          provider={provider}
          model={displayModel}
          effort={null}
          fastMode={fastMode}
          fastModeSupported={fastModeSupported}
          machine={null}
          testIdPrefix={testIdPrefix}
          disabled={disabled}
          ariaLabel={mobileSummaryLabel}
          onEdit={() => setEditorOpen(true)}
          mode="minimal"
        />
      )}
      {rowEndBelow}
      <Dialog
        ownerKey={editorOpenOwnerKey}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Edit model selection</DialogTitle>
        <DialogContent sx={{ pt: 1.5 }}>
          {buildEditor(testIdPrefix, "column")}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditorOpen(false)}>Done</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        ownerKey={manageFavoritesOpenOwnerKey}
        open={manageFavoritesOpen}
        onClose={() => setManageFavoritesOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Manage favorites</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ pt: 1 }}>
            {favorites.map((favorite) => (
              <Stack
                key={favorite.id}
                direction="row"
                spacing={1}
                alignItems="center"
                data-testid={`${testIdPrefix}-favorite-management-row`}
                data-favorite-id={favorite.id}
              >
                <Typography sx={{ flex: 1 }}>{favorite.name}</Typography>
                <Button
                  size="small"
                  onClick={() => {
                    setManageFavoritesOpen(false);
                    openFavoriteDialog({ kind: "rename", favorite });
                  }}
                  data-testid={`${testIdPrefix}-favorite-rename`}
                >
                  Rename
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={() => onDeleteFavorite(favorite.id)}
                  data-testid={`${testIdPrefix}-favorite-delete`}
                >
                  Delete
                </Button>
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManageFavoritesOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={favoriteDialog.kind !== "closed"}
        onClose={closeFavoriteDialog}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {favoriteDialog.kind === "rename"
            ? "Rename favorite"
            : "Save favorite"}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="Favorite name"
            value={favoriteName}
            onChange={(event) => {
              setFavoriteName(event.target.value);
              setFavoriteNameError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitFavoriteDialog();
            }}
            error={favoriteNameError !== null}
            helperText={favoriteNameError}
            data-testid={`${testIdPrefix}-favorite-name-input`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeFavoriteDialog}>Cancel</Button>
          <Button
            onClick={submitFavoriteDialog}
            data-testid={`${testIdPrefix}-favorite-dialog-submit`}
          >
            {favoriteDialog.kind === "rename" ? "Rename" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};
