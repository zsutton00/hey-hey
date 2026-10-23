import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import React from "react";
import type { GenerationSystemMessageData } from "../../../../api";
import { useInitiatives } from "../../../../data/hooks/useInitiatives";
import type { FieldComponentContext, FieldComponentProps } from "../types";
import { Initiatives } from "./Initiatives";
import { useInitiativeField } from "./useInitiativeField";

export interface InitiativeFieldProps
  extends Omit<FieldComponentProps, "onChange"> {
  value: GenerationSystemMessageData;
  onChange?: (value: unknown) => void;
  context: FieldComponentContext;
}

export const InitiativeField: React.FC<InitiativeFieldProps> = ({
  context,
  config,
  value,
  onChange,
  isSubmitted,
  disabled,
}) => {
  // Load conversation initiatives using the extended useInitiatives hook
  const {
    initiatives,
    isLoading: isLoadingInitiatives,
    error: initiativesError,
    refetch: originalRefetchInitiatives,
    create,
    remove,
  } = useInitiatives(
    context.organizationId,
    context.projectId,
    context.conversationId, // Conversation-specific query
    { enabled: !!context.conversationId }
  );

  // Wrap refetch to match expected interface
  const refetchInitiatives = React.useCallback(async (): Promise<void> => {
    await originalRefetchInitiatives();
  }, [originalRefetchInitiatives]);

  const {
    reviewedInitiatives,
    validationError,
    response,
    handleInitiativeClick,
    handleAcknowledge,
  } = useInitiativeField({
    value,
    onChange,
    initiatives,
  });

  // Show loading state
  if (isLoadingInitiatives) {
    return (
      <Box data-testid={`initiative-field-${config.field}`}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            py: 4,
          }}
        >
          <CircularProgress size={24} sx={{ mr: 2 }} />
          <Typography variant="body2" color="text.secondary">
            Loading initiatives...
          </Typography>
        </Box>
      </Box>
    );
  }

  // Show error state
  if (initiativesError) {
    return (
      <Box data-testid={`initiative-field-${config.field}`}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {initiativesError instanceof Error
            ? initiativesError.message
            : "Failed to load initiatives"}
        </Alert>
      </Box>
    );
  }

  // Always render list view - navigation handles edit mode
  return (
    <Box data-testid={`initiative-field-${config.field}`}>
      <Initiatives
        data={value}
        response={response}
        onAcknowledge={handleAcknowledge}
        isSubmitting={disabled || isSubmitted || false}
        reviewedInitiatives={reviewedInitiatives}
        onInitiativeClick={handleInitiativeClick}
        projectId={context.projectId}
        onInitiativeCreate={create}
        onInitiativeDelete={(initiative) => {
          remove(initiative.id);
        }}
        conversationId={context.conversationId}
        organizationId={context.organizationId}
        initiatives={initiatives}
        onInitiativeCreated={refetchInitiatives}
      />

      {/* Display validation error if present */}
      {validationError && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {validationError}
        </Alert>
      )}
    </Box>
  );
};
