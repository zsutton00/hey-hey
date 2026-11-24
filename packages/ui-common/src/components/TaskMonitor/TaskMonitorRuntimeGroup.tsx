import { Alert, Button, Stack, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import type { TaskMonitorRuntimeSelection } from "../../api";
import { RuntimeModelSelector } from "../AgentSession/RuntimeModelSelector";
import type { RuntimeModelCatalogSource } from "../AgentSession/useRuntimeModelCatalog";
import { normalizeFastMode } from "./taskMonitorRuntimeSelection";

/** The provider a coordinator launches on when the monitor has no saved runtime. */
const LAUNCH_DEFAULT_PROVIDER = "claude";

interface RuntimeDraft {
  provider: TaskMonitorRuntimeSelection["provider"] | null;
  model: string | null;
  reasoningEffort: NonNullable<
    TaskMonitorRuntimeSelection["reasoningEffort"]
  > | null;
  fastMode: boolean;
}

const draftFrom = (
  value: TaskMonitorRuntimeSelection | null,
): RuntimeDraft => ({
  provider: value?.provider ?? null,
  model: value?.model ?? null,
  reasoningEffort: value?.reasoningEffort ?? null,
  fastMode: value?.fastMode ?? false,
});

const describe = (value: TaskMonitorRuntimeSelection): string =>
  [
    value.provider,
    value.model,
    value.reasoningEffort ?? null,
    value.fastMode ? "Fast mode" : null,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * A labelled provider/model/effort group for a monitor-level runtime. Reusable by any
 * monitor-owned runtime setting; it never writes browser selection memory.
 */
export function TaskMonitorRuntimeGroup({
  label,
  testId,
  defaultLabel,
  onClear,
  value,
  catalogSource,
  editable,
  isSaving,
  onSave,
  onBusyChange,
}: {
  label: string;
  testId: string;
  /** What runs when nothing is saved, shown read-only. */
  defaultLabel: string;
  /** When given, an editable saved value can be cleared back to the default. */
  onClear?: () => Promise<void>;
  value: TaskMonitorRuntimeSelection | null;
  catalogSource: RuntimeModelCatalogSource | null;
  editable: boolean;
  isSaving: boolean;
  onSave: (selection: TaskMonitorRuntimeSelection) => Promise<void>;
  /** True from a choice until it is saved and refreshed, or has failed and been reverted. */
  onBusyChange: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState<RuntimeDraft>(() => draftFrom(value));
  const draftRef = useRef(draft);
  const pendingRef = useRef<TaskMonitorRuntimeSelection | null>(null);
  const saveInFlightRef = useRef(false);
  // The catalog selector also reconciles the shown values to what the machine
  // offers; only a person's own interaction persists a choice.
  const userTouchedRef = useRef(false);
  const [isSavingLocally, setIsSavingLocally] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const savedValueRef = useRef(value);
  savedValueRef.current = value;

  useEffect(() => {
    onBusyChange(isSavingLocally);
    return () => onBusyChange(false);
  }, [isSavingLocally, onBusyChange]);

  useEffect(() => {
    const next = draftFrom(value);
    draftRef.current = next;
    setDraft(next);
    setSaveError(null);
  }, [value]);

  const persist = async (next: RuntimeDraft): Promise<void> => {
    draftRef.current = next;
    setDraft(next);
    if (
      !userTouchedRef.current ||
      next.provider === null ||
      next.model === null
    ) {
      return;
    }

    // A model that offers no effort choices is saved without an effort.
    pendingRef.current = normalizeFastMode({
      provider: next.provider,
      model: next.model,
      ...(next.reasoningEffort === null
        ? {}
        : { reasoningEffort: next.reasoningEffort }),
      fastMode: next.fastMode,
    });
    setSaveError(null);
    if (saveInFlightRef.current) {
      return;
    }

    saveInFlightRef.current = true;
    setIsSavingLocally(true);
    await Promise.resolve();
    try {
      while (pendingRef.current) {
        const pending = pendingRef.current;
        pendingRef.current = null;
        await onSave(pending);
      }
    } catch (error) {
      pendingRef.current = null;
      // Show what is actually saved, so Start never launches a choice the
      // picker no longer displays.
      const saved = draftFrom(savedValueRef.current);
      draftRef.current = saved;
      setDraft(saved);
      setSaveError(
        error instanceof Error
          ? error.message
          : `Unable to save ${label.toLowerCase()}.`,
      );
    } finally {
      saveInFlightRef.current = false;
      setIsSavingLocally(false);
    }
  };

  const update = (change: Partial<RuntimeDraft>): void => {
    void persist({ ...draftRef.current, ...change });
  };

  return (
    <Stack
      spacing={1}
      data-testid={testId}
      onClickCapture={() => {
        userTouchedRef.current = true;
      }}
      onKeyDownCapture={() => {
        userTouchedRef.current = true;
      }}
    >
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      {editable ? (
        <RuntimeModelSelector
          catalogSource={catalogSource}
          preferredProvider={LAUNCH_DEFAULT_PROVIDER}
          provider={draft.provider}
          model={draft.model}
          reasoningEffort={draft.reasoningEffort}
          fastMode={draft.fastMode}
          onProviderChange={(provider) => update({ provider })}
          onModelChange={(model) => update({ model })}
          onReasoningEffortChange={(reasoningEffort) =>
            update({ reasoningEffort })
          }
          onFastModeChange={(fastMode) => update({ fastMode })}
          disabled={isSaving || isSavingLocally}
          testIdPrefix={`${testId}-runtime`}
        />
      ) : (
        <Typography data-testid={`${testId}-readonly`}>
          {value ? describe(value) : defaultLabel}
        </Typography>
      )}
      {editable && onClear && value ? (
        <Button
          size="small"
          sx={{ alignSelf: "flex-start" }}
          data-testid={`${testId}-clear`}
          disabled={isSaving || isSavingLocally}
          onClick={() => {
            setSaveError(null);
            setIsSavingLocally(true);
            onClear()
              .catch((error: unknown) => {
                setSaveError(
                  error instanceof Error
                    ? error.message
                    : `Unable to clear ${label.toLowerCase()}.`,
                );
              })
              .finally(() => setIsSavingLocally(false));
          }}
        >
          Use default
        </Button>
      ) : null}
      {saveError ? <Alert severity="error">{saveError}</Alert> : null}
    </Stack>
  );
}
