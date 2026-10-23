import { Alert, Stack } from "@mui/material";
import { useEffect, useMemo } from "react";
import type {
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
} from "../../api";
import { listCatalogNotices, listProviders } from "./capabilityCatalog";
import {
  FavoriteModelSelector,
  type FavoriteModelSelectorProps,
} from "./FavoriteModelSelector";
import { ModelSelectorMachineSelection } from "./ModelSelector";
import {
  buildDefaultSurfaceSelection,
  reconcileSurfaceSelection,
} from "./surfaceSelectionMemory";
import {
  type RuntimeModelCatalogSource,
  useRuntimeModelCatalog,
} from "./useRuntimeModelCatalog";

export const CatalogUnavailableAlert = ({
  testIdPrefix,
  error,
}: {
  testIdPrefix: string;
  error: string;
}) => (
  <Alert severity="error" data-testid={`${testIdPrefix}-catalog-error`}>
    Model catalog unavailable. Provider and model options cannot be shown.
    {error ? ` ${error}` : ""}
  </Alert>
);

export const CatalogLoadingAlert = ({
  testIdPrefix,
}: {
  testIdPrefix: string;
}) => (
  <Alert severity="info" data-testid={`${testIdPrefix}-catalog-loading`}>
    Loading model catalog...
  </Alert>
);

export const CatalogMachineRequiredAlert = ({
  testIdPrefix,
}: {
  testIdPrefix: string;
}) => (
  <Alert
    severity="info"
    data-testid={`${testIdPrefix}-catalog-machine-required`}
  >
    Select a machine to see the models its CLI can launch.
  </Alert>
);

/** The CLI's explanation for each installed provider that reported zero models. */
export const CatalogNotices = ({ testIdPrefix }: { testIdPrefix: string }) => (
  <>
    {listCatalogNotices().map(({ provider, notice }) => (
      <Alert
        key={provider}
        severity="info"
        data-testid={`${testIdPrefix}-catalog-notice-${provider}`}
      >
        {notice}
      </Alert>
    ))}
  </>
);

/**
 * Props of {@link RuntimeModelSelector}. The selection is nullable because
 * nothing is preselected until the CLI's catalog has loaded; `catalogSource`
 * names the machine whose CLI is asked, and is null until one is picked.
 */
export type RuntimeModelSelectorProps = Omit<
  FavoriteModelSelectorProps,
  "provider" | "model" | "reasoningEffort"
> & {
  provider: ConversationStartRunRequestDtoProviderEnum | null;
  model: string | null;
  reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum | null;
  catalogSource: RuntimeModelCatalogSource | null;
};

export const RuntimeModelSelector = ({
  catalogSource,
  provider,
  model,
  reasoningEffort,
  ...props
}: RuntimeModelSelectorProps) => {
  const state = useRuntimeModelCatalog(catalogSource);
  const testIdPrefix = props.testIdPrefix ?? "model-selector";
  const ready = state.status === "ready";
  const reconciledSelection =
    ready && provider !== null && model !== null
      ? reconcileSurfaceSelection({
          provider,
          model,
          reasoningEffort,
          fastMode: props.fastMode ?? false,
        })
      : null;
  // The picked machine's CLI may not offer what the surface held (another
  // machine, or a remembered choice): fall back to what that CLI offers.
  const needsCatalogDefault = ready && reconciledSelection === null;
  const catalogDefault = useMemo(
    () => (needsCatalogDefault ? buildDefaultSurfaceSelection() : null),
    // The default is read from the active catalog, which `state` stands for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needsCatalogDefault, state],
  );
  const reconciledModel = reconciledSelection?.model;
  const reconciledReasoningEffort = reconciledSelection?.reasoningEffort;
  const reconciledFastMode = reconciledSelection?.fastMode;
  const { onProviderChange, onModelChange, onReasoningEffortChange } = props;
  const { onFastModeChange } = props;
  const fastMode = props.fastMode;

  useEffect(() => {
    if (catalogDefault) {
      onProviderChange(catalogDefault.provider);
      onModelChange(catalogDefault.model);
      onReasoningEffortChange(catalogDefault.reasoningEffort);
      onFastModeChange(false);
      return;
    }
    if (!ready || !reconciledModel || reconciledReasoningEffort === undefined) {
      return;
    }
    if (reconciledModel !== model) {
      onModelChange(reconciledModel);
    }
    if (reconciledReasoningEffort !== reasoningEffort) {
      onReasoningEffortChange(reconciledReasoningEffort);
    }
    if (reconciledFastMode !== undefined && reconciledFastMode !== fastMode) {
      onFastModeChange(reconciledFastMode);
    }
  }, [
    catalogDefault,
    fastMode,
    model,
    onFastModeChange,
    onModelChange,
    onProviderChange,
    onReasoningEffortChange,
    ready,
    reasoningEffort,
    reconciledFastMode,
    reconciledModel,
    reconciledReasoningEffort,
  ]);

  const machineSelection = (
    <>
      <ModelSelectorMachineSelection
        testIdPrefix={testIdPrefix}
        machineSelection={props.machineSelection}
      />
      {props.rowEnd}
    </>
  );

  if (catalogSource === null && state.status === "idle") {
    return (
      <Stack spacing={1}>
        <CatalogMachineRequiredAlert testIdPrefix={testIdPrefix} />
        {machineSelection}
      </Stack>
    );
  }

  if (state.status === "idle" || state.status === "loading") {
    return (
      <Stack spacing={1}>
        <CatalogLoadingAlert testIdPrefix={testIdPrefix} />
        {machineSelection}
      </Stack>
    );
  }

  if (state.status === "error") {
    return (
      <Stack spacing={1}>
        <CatalogUnavailableAlert
          testIdPrefix={testIdPrefix}
          error={state.error}
        />
        {machineSelection}
      </Stack>
    );
  }

  if (!reconciledSelection) {
    // Either the surface is about to adopt the CLI's default (rendered next
    // pass), or the CLI offers nothing launchable and its notices say why.
    return (
      <Stack spacing={1}>
        {catalogDefault ? (
          <CatalogLoadingAlert testIdPrefix={testIdPrefix} />
        ) : listProviders().length > 0 ? (
          <CatalogNotices testIdPrefix={testIdPrefix} />
        ) : (
          <Alert
            severity="warning"
            data-testid={`${testIdPrefix}-catalog-selection-error`}
          >
            The CLI on this machine reported no providers it can launch.
          </Alert>
        )}
        {machineSelection}
      </Stack>
    );
  }

  return (
    <Stack spacing={1} data-testid={`${testIdPrefix}-catalog-ready`}>
      <FavoriteModelSelector
        {...props}
        provider={reconciledSelection.provider}
        fastMode={reconciledSelection.fastMode ?? false}
        model={reconciledSelection.model}
        reasoningEffort={reconciledSelection.reasoningEffort}
      />
      <CatalogNotices testIdPrefix={testIdPrefix} />
    </Stack>
  );
};
