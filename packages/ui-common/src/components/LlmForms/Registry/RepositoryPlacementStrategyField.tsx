import {
  Box,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import {
  FeatureTag,
  type RepositoryPlacementStrategyPayload,
  type RepositoryPlacementStrategySubmission,
} from "../../../api";
import { useFeatureHierarchy } from "../../../data/hooks/useFeatureHierarchy";
import { FeaturePicker } from "../../Features/FeaturePicker";
import type { FieldComponentProps } from "./types";

type Strategy = RepositoryPlacementStrategySubmission["action"];
type SharedParentMode = "existing" | "holder";
type ExistingFeatureAvailability = "loading" | "available" | "empty" | "error";

const StrategyLabel: React.FC<{
  title: string;
  description: string;
}> = ({ title, description }) => (
  <Box>
    <Typography variant="body1">{title}</Typography>
    <Typography variant="body2" color="text.secondary">
      {description}
    </Typography>
  </Box>
);

const isPayload = (
  value: unknown
): value is RepositoryPlacementStrategyPayload =>
  typeof value === "object" && value !== null && "roots" in value;

export const RepositoryPlacementStrategyField: React.FC<
  FieldComponentProps<RepositoryPlacementStrategySubmission>
> = ({
  config,
  value,
  onChange,
  disabled,
  isSubmitted,
  context,
  onValidityChange,
}) => {
  const payload = isPayload(config.payload) ? config.payload : undefined;
  const [strategy, setStrategy] = useState<Strategy | "">(value?.action ?? "");
  const [parentMode, setParentMode] = useState<SharedParentMode>(
    value?.action === "ADD_TO_EXISTING" &&
      value.parent.targetType === "PENDING_HOLDER"
      ? "holder"
      : "existing"
  );
  const [featureId, setFeatureId] = useState<string | null>(
    value?.action === "ADD_TO_EXISTING" &&
      value.parent.targetType === "EXISTING_FEATURE"
      ? value.parent.featureId
      : null
  );
  const [holderName, setHolderName] = useState("");
  const [holderDescription, setHolderDescription] = useState("");
  const [holderTag, setHolderTag] = useState<FeatureTag>(FeatureTag.Product);
  const featureHierarchy = useFeatureHierarchy(
    context.organizationId,
    context.projectId
  );
  const existingFeatureAvailability: ExistingFeatureAvailability =
    featureHierarchy.error
      ? "error"
      : !featureHierarchy.isReady
        ? "loading"
        : featureHierarchy.nodes.size > 0
          ? "available"
          : "empty";
  const readOnly = disabled || isSubmitted;
  const rootCount = payload?.roots.length ?? 0;
  const featureDependentChoicesDisabled =
    existingFeatureAvailability === "loading" ||
    existingFeatureAvailability === "empty";

  const submission = useMemo<
    RepositoryPlacementStrategySubmission | undefined
  >(() => {
    if (
      featureDependentChoicesDisabled &&
      strategy !== "" &&
      strategy !== "ADD_AT_ROOT"
    ) {
      return undefined;
    }
    if (strategy === "ADD_AT_ROOT" || strategy === "INTELLIGENTLY_INTEGRATE") {
      return { action: strategy };
    }
    if (strategy !== "ADD_TO_EXISTING") return undefined;
    if (parentMode === "existing") {
      return featureId
        ? {
            action: strategy,
            parent: { targetType: "EXISTING_FEATURE", featureId },
          }
        : undefined;
    }
    return holderName.trim() && holderDescription.trim()
      ? {
          action: strategy,
          parent: {
            targetType: "PENDING_HOLDER",
            name: holderName.trim(),
            description: holderDescription.trim(),
            tag: holderTag,
          },
        }
      : undefined;
  }, [
    featureId,
    holderDescription,
    holderName,
    holderTag,
    parentMode,
    strategy,
    featureDependentChoicesDisabled,
  ]);

  const handleStrategyChange = (nextStrategy: Strategy): void => {
    if (featureDependentChoicesDisabled && nextStrategy !== "ADD_AT_ROOT") {
      return;
    }
    setStrategy(nextStrategy);
  };

  useEffect(() => {
    onValidityChange?.(submission ? "valid" : "invalid");
    if (submission) onChange?.(submission);
  }, [onChange, onValidityChange, submission]);

  return (
    <Stack spacing={2.5} data-testid="repository-placement-strategy">
      <Box>
        <Typography variant="h6">
          Place {payload?.roots.length ?? 0} proposed root Features
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Children remain attached to their proposed root regardless of this
          choice.
        </Typography>
      </Box>
      <FormControl disabled={readOnly}>
        <FormLabel>Placement strategy</FormLabel>
        <RadioGroup
          value={strategy}
          onChange={(event) =>
            handleStrategyChange(event.target.value as Strategy)
          }
        >
          <FormControlLabel
            value="ADD_AT_ROOT"
            control={<Radio />}
            label={
              <StrategyLabel
                title="Add at project root"
                description={`${rootCount} ${
                  rootCount === 1 ? "feature" : "features"
                } will be added to the project's feature tree at the root.`}
              />
            }
          />
          <FormControlLabel
            disabled={readOnly || featureDependentChoicesDisabled}
            value="ADD_TO_EXISTING"
            control={<Radio />}
            label={
              <StrategyLabel
                title="Add to a parent feature"
                description="Choose an existing Feature or create a new one."
              />
            }
          />
          <FormControlLabel
            disabled={readOnly || featureDependentChoicesDisabled}
            value="INTELLIGENTLY_INTEGRATE"
            control={<Radio />}
            label={
              <StrategyLabel
                title="Intelligently integrate each root"
                description="Use your Agent Bridge to determine the best fit."
              />
            }
          />
        </RadioGroup>
      </FormControl>
      {strategy === "ADD_TO_EXISTING" && (
        <Stack spacing={2}>
          <RadioGroup
            row
            value={parentMode}
            onChange={(event) =>
              setParentMode(event.target.value as SharedParentMode)
            }
          >
            <FormControlLabel
              disabled={readOnly}
              value="existing"
              control={<Radio />}
              label="Existing Feature"
            />
            <FormControlLabel
              disabled={readOnly}
              value="holder"
              control={<Radio />}
              label="New grouping Feature"
            />
          </RadioGroup>
          {parentMode === "existing" ? (
            <FeaturePicker
              organizationId={context.organizationId}
              projectId={context.projectId}
              label="Parent Feature"
              value={featureId}
              onChange={(id) => setFeatureId(id)}
              disabled={readOnly}
              searchable
            />
          ) : (
            <Stack spacing={1.5}>
              <TextField
                label="Grouping Feature name"
                value={holderName}
                disabled={readOnly}
                onChange={(event) => setHolderName(event.target.value)}
              />
              <TextField
                label="Description"
                value={holderDescription}
                disabled={readOnly}
                multiline
                minRows={2}
                onChange={(event) => setHolderDescription(event.target.value)}
              />
              <TextField
                select
                label="Feature tag"
                value={holderTag}
                disabled={readOnly}
                onChange={(event) =>
                  setHolderTag(event.target.value as FeatureTag)
                }
              >
                {Object.values(FeatureTag).map((tag) => (
                  <MenuItem key={tag} value={tag}>
                    {tag}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          )}
        </Stack>
      )}
    </Stack>
  );
};
