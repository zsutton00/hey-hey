import React, { useCallback, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type {
  CreateServiceDto,
  CreateServiceDtoServiceTypeEnum,
  ServiceDto,
} from "../../api";
import {
  type CreateServiceDirectorySetupState,
  useCreateServiceDirectorySetup,
} from "./useCreateServiceDirectorySetup";
import { useCreateServiceFormWalkthrough } from "./useCreateServiceFormWalkthrough";
import { MINI_DEMO_TARGETS } from "../MiniDemoPlayer/types";

export interface CreateServiceFormProps {
  organizationId: string;
  projectId: string;
  onSuccess?: (service: ServiceDto) => void;
  onCancel?: () => void;
  /**
   * Seed values for the form fields. Used by onboarding mini-demo scenes to
   * render the form in a realistic filled-in state; production callers omit it
   * and the form starts empty.
   */
  initialValues?: {
    name?: string;
    description?: string;
    serviceType?: CreateServiceDtoServiceTypeEnum;
    tags?: string;
  };
}

const SERVICE_TYPES: Array<{
  value: CreateServiceDtoServiceTypeEnum;
  label: string;
}> = [
  { value: "backend", label: "Backend" },
  { value: "ui", label: "UI" },
  { value: "database", label: "Database" },
  { value: "worker", label: "Worker" },
  { value: "mobile", label: "Mobile" },
  { value: "desktop", label: "Desktop" },
  { value: "library", label: "Library" },
  { value: "other", label: "Other" },
];

export const CreateServiceForm: React.FC<CreateServiceFormProps> = ({
  organizationId,
  projectId,
  onSuccess,
  onCancel,
  initialValues,
}) => {
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(
    initialValues?.description ?? "",
  );
  const [serviceType, setServiceType] =
    useState<CreateServiceDtoServiceTypeEnum>(
      initialValues?.serviceType ?? "backend",
    );
  const [tagsInput, setTagsInput] = useState(initialValues?.tags ?? "");

  const resetForm = useCallback((): void => {
    setName("");
    setDescription("");
    setServiceType("backend");
    setTagsInput("");
    setError(null);
  }, []);

  // A type is always selected, so a non-empty name completes the details.
  const { detailsTargetRef, submitTargetRef, reportServiceCreated } =
    useCreateServiceFormWalkthrough(name.trim() !== "");

  const { state, create, retryLinking, finishLater, isBusy } =
    useCreateServiceDirectorySetup({
      onComplete: (newService) => {
        resetForm();
        reportServiceCreated();
        onSuccess?.(newService);
      },
    });

  const creationError = state.status === "creation-failed" ? state.error : null;
  const handleCreateService = useCallback((): void => {
    if (!organizationId) {
      setError("Organization ID is required");
      return;
    }

    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setError(null);

    const tags = tagsInput
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    const serviceData: CreateServiceDto = {
      name: name.trim(),
      organizationId,
      projectId,
      description: description.trim() || undefined,
      serviceType,
      tags: tags.length > 0 ? tags : undefined,
    };

    void create({
      organizationId,
      service: serviceData,
      linkDirectory: false,
    });
  }, [
    create,
    description,
    name,
    organizationId,
    projectId,
    serviceType,
    tagsInput,
  ]);

  const handleCancel = useCallback((): void => {
    if (!isBusy) {
      resetForm();
      onCancel?.();
    }
  }, [isBusy, onCancel, resetForm]);

  if (
    state.status === "picking" ||
    state.status === "binding" ||
    state.status === "linked" ||
    state.status === "cancelled" ||
    state.status === "binding-failed" ||
    state.status === "created-without-binding"
  ) {
    return (
      <DirectorySetupResult
        state={state}
        onRetry={() => void retryLinking()}
        onFinishLater={finishLater}
      />
    );
  }

  return (
    <Stack spacing={3} sx={{ py: 1 }}>
      {(error || creationError) && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error ?? creationError}
        </Alert>
      )}

      {state.status === "creating" ? (
        <CreationProgress />
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            Provide details for your new service
          </Typography>
          <Stack spacing={3}>
            <Stack spacing={3} ref={detailsTargetRef}>
              <TextField
                label="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                fullWidth
                required
                autoFocus
                placeholder="e.g., User Service API"
                helperText="A descriptive name for your service"
              />

              <TextField
                label="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                fullWidth
                multiline
                rows={4}
                placeholder="Describe what this service does..."
                helperText="Optional: Brief description of the service's purpose"
              />

              <TextField
                label="Type"
                value={serviceType}
                onChange={(event) =>
                  setServiceType(
                    event.target.value as CreateServiceDtoServiceTypeEnum,
                  )
                }
                select
                fullWidth
                helperText="Select the type of service"
              >
                {SERVICE_TYPES.map((type) => (
                  <MenuItem key={type.value} value={type.value}>
                    {type.label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            <TextField
              label="Tags"
              value={tagsInput}
              onChange={(event) => setTagsInput(event.target.value)}
              fullWidth
              placeholder="e.g., api, payments, internal"
              helperText="Optional: comma-separated tags"
            />
          </Stack>
        </>
      )}

      <Stack direction="row" spacing={2} justifyContent="flex-start">
        <Button onClick={handleCancel} disabled={isBusy}>
          Cancel
        </Button>
        <Button
          ref={submitTargetRef}
          onClick={handleCreateService}
          variant="contained"
          disabled={!name.trim() || isBusy}
          data-testid="create-service-submit"
          data-demo-target={MINI_DEMO_TARGETS.createServiceSubmitButton}
        >
          Create Service
        </Button>
      </Stack>
    </Stack>
  );
};

const CreationProgress: React.FC = () => (
  <Box
    display="flex"
    flexDirection="column"
    alignItems="center"
    justifyContent="center"
    minHeight={200}
    gap={2}
    data-testid="create-service-progress"
  >
    <CircularProgress size={40} />
    <Typography variant="body2" color="text.secondary">
      Creating Service...
    </Typography>
  </Box>
);

interface DirectorySetupResultProps {
  state: Exclude<
    CreateServiceDirectorySetupState,
    { status: "idle" } | { status: "creating" } | { status: "creation-failed" }
  >;
  onRetry: () => void;
  onFinishLater: () => void;
}

const DirectorySetupResult: React.FC<DirectorySetupResultProps> = ({
  state,
  onRetry,
  onFinishLater,
}) => {
  if (state.status === "picking" || state.status === "binding") {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight={200}
        gap={2}
        data-testid="service-directory-binding-progress"
      >
        <CircularProgress size={40} />
        <Typography variant="body2" color="text.secondary">
          {state.status === "picking"
            ? "Service created. Choose a directory on this CLI machine."
            : "Service created. Linking the selected directory..."}
        </Typography>
      </Box>
    );
  }

  if (state.status === "linked") {
    return (
      <Alert severity="success" data-testid="service-directory-linked">
        Service created and linked to the directory on this CLI machine.
      </Alert>
    );
  }

  if (state.status === "created-without-binding") {
    return (
      <Alert severity="success" data-testid="service-created-without-directory">
        Service created. You can link a directory from a reachable CLI later.
      </Alert>
    );
  }

  const isCancelled = state.status === "cancelled";
  return (
    <Stack spacing={2} data-testid="service-directory-recovery">
      <Alert severity={isCancelled ? "info" : "error"}>
        <Typography variant="body2">
          {isCancelled
            ? "Directory selection was cancelled."
            : `The directory could not be linked: ${state.error}`}
        </Typography>
        <Typography variant="body2">
          The Service was created and is safe. Retry linking on a reachable CLI,
          or finish and link it later.
        </Typography>
      </Alert>

      <Stack direction="row" spacing={2}>
        <Button
          variant="contained"
          onClick={onRetry}
          data-testid="retry-service-directory-link"
        >
          Retry linking
        </Button>
        <Button
          onClick={onFinishLater}
          data-testid="finish-service-directory-later"
        >
          Finish and link later
        </Button>
      </Stack>
    </Stack>
  );
};
