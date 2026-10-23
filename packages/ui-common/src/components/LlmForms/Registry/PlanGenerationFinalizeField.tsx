import { Box, LinearProgress, Stack, Typography } from "@mui/material";
import React, { useEffect, useMemo, useRef } from "react";
import type { PlanGenerationFinalizePayload } from "../../../api";
import { useCanonicalPlanAggregate } from "../../../data/hooks/useCanonicalPlanAggregate";
import {
  createPlanGenerationFinalizeValue,
  normalizePlanGenerationFinalizeValue,
} from "./planGenerationFinalizeUtils";
import type { FieldComponentProps } from "./types";
import type { PlanGenerationFinalizeValue } from "./types";

const isPlanGenerationFinalizePayload = (
  value: unknown
): value is PlanGenerationFinalizePayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PlanGenerationFinalizePayload>;
  return (
    typeof candidate.planId === "string" &&
    typeof candidate.firstStageId === "string" &&
    typeof candidate.readyButtonLabel === "string" &&
    typeof candidate.progressLabel === "string"
  );
};

export type PlanGenerationFinalizeFieldProps =
  FieldComponentProps<PlanGenerationFinalizeValue>;

export const PlanGenerationFinalizeField: React.FC<
  PlanGenerationFinalizeFieldProps
> = ({ config, value, onChange, context }) => {
  const payload = isPlanGenerationFinalizePayload(config.payload)
    ? config.payload
    : undefined;

  const fallbackValue = useMemo(
    () => (payload ? createPlanGenerationFinalizeValue(payload) : undefined),
    [payload]
  );

  const normalizedValue = useMemo(() => {
    if (!fallbackValue) {
      return value;
    }
    return normalizePlanGenerationFinalizeValue(value, fallbackValue);
  }, [value, fallbackValue]);

  const planId = normalizedValue?.planId ?? payload?.planId;
  const progressLabel =
    normalizedValue?.progressLabel ?? payload?.progressLabel ?? "";

  const isPending = normalizedValue?.status !== "READY";
  const aggregate = useCanonicalPlanAggregate(
    context.organizationId,
    context.projectId,
    planId ?? ""
  );

  const hasSeededRef = useRef(false);
  useEffect(() => {
    if (hasSeededRef.current) {
      return;
    }
    if (!fallbackValue || !onChange) {
      return;
    }
    if (value !== undefined) {
      hasSeededRef.current = true;
      return;
    }
    onChange(fallbackValue);
    hasSeededRef.current = true;
  }, [fallbackValue, onChange, value]);

  useEffect(() => {
    if (!normalizedValue || !onChange) {
      return;
    }
    if (
      aggregate.status === "ready" &&
      normalizedValue.status !== "READY"
    ) {
      onChange({ ...normalizedValue, status: "READY" });
    }
  }, [aggregate.status, normalizedValue, onChange]);

  if (!payload) {
    return null;
  }

  return (
    <Stack
      spacing={2}
      alignItems="center"
      sx={{ width: "100%", textAlign: "center" }}
      data-testid={`plan-generation-finalize-${config.field}`}
    >
      <Typography variant="body2" color="text.secondary">
        {progressLabel}
      </Typography>
      <Box sx={{ width: "100%", maxWidth: 480 }}>
        <LinearProgress
          variant={isPending ? "indeterminate" : "determinate"}
          value={isPending ? undefined : 100}
        />
      </Box>
    </Stack>
  );
};
