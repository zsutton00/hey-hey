import AddIcon from "@mui/icons-material/Add";
import { Box, Button, Stack, Typography } from "@mui/material";
import React, { useCallback, useMemo } from "react";
import type { ServiceDto } from "../../../api";
import { useModalService } from "../../../contexts/ModalService";
import { PlanGapsAddedExistingList } from "./PlanGapsShared";
import { ServiceSelector } from "../../Selectors/ServiceSelector";
import type { FieldComponentProps } from "./types";
import type {
  PlanServiceSelectionService,
  PlanServiceSelectionValue,
  ServiceSelectorFieldConfig,
} from "./types";
import {
  createPlanServiceSelectionValue,
  normalizePlanServiceSelectionValue,
} from "./planServiceSelectionUtils";

export interface ServiceSelectorFieldProps
  extends Omit<FieldComponentProps<PlanServiceSelectionValue>, "config"> {
  config: ServiceSelectorFieldConfig;
}

const INTRO_TEXT =
  "Choose all services that will be used for this plan. Add missing services now so the plan covers them.";

const buildServiceSelection = (
  service: ServiceDto
): PlanServiceSelectionService => ({
  source: "user_added",
  kind: "existing",
  entityType: "services",
  entityId: service.id,
  name: service.name?.trim() || "Untitled service",
  description: service.description?.trim() || undefined,
});

export const ServiceSelectorField: React.FC<ServiceSelectorFieldProps> = ({
  config,
  value,
  onChange,
  disabled = false,
  isSubmitted = false,
  context,
}) => {
  const modalService = useModalService();

  const fallbackValue = useMemo(() => createPlanServiceSelectionValue(), []);
  const fieldValue = useMemo(
    () => normalizePlanServiceSelectionValue(value, fallbackValue),
    [value, fallbackValue]
  );

  const isLocked = disabled || isSubmitted;

  const selectedServiceIds = useMemo(
    () => fieldValue.services.map((item) => item.entityId),
    [fieldValue.services]
  );

  const updateServices = useCallback(
    (services: PlanServiceSelectionService[]) => {
      onChange?.({
        ...fieldValue,
        services,
      });
    },
    [fieldValue, onChange]
  );

  const handleSelectorChange = useCallback(
    (serviceIds: string[], services: ServiceDto[]) => {
      const existingById = new Map(
        fieldValue.services.map((s) => [s.entityId, s])
      );

      const nextServices = serviceIds.map((id) => {
        const existing = existingById.get(id);
        if (existing) return existing;

        const dto = services.find((s) => s.id === id);
        if (dto) return buildServiceSelection(dto);

        return {
          source: "user_added" as const,
          kind: "existing" as const,
          entityType: "services" as const,
          entityId: id,
          name: "Unknown service",
          description: undefined,
        };
      });

      updateServices(nextServices);
    },
    [fieldValue.services, updateServices]
  );

  const handleRemoveService = useCallback(
    (entityId: string) => {
      updateServices(
        fieldValue.services.filter((item) => item.entityId !== entityId)
      );
    },
    [fieldValue.services, updateServices]
  );

  const handleAddService = useCallback(
    (service: ServiceDto) => {
      const next = buildServiceSelection(service);
      const existingIds = new Set(
        fieldValue.services.map((item) => item.entityId)
      );
      if (existingIds.has(next.entityId)) {
        return;
      }
      updateServices([...fieldValue.services, next]);
    },
    [fieldValue.services, updateServices]
  );

  const handleCreateService = useCallback(() => {
    if (!modalService) {
      return;
    }

    modalService.showCreateService({
      projectId: context.projectId,
      onSuccess: (service) => {
        handleAddService(service);
        modalService.close();
      },
    });
  }, [context.projectId, handleAddService, modalService]);

  return (
    <Stack spacing={2} data-testid={`service-selector-${config.field}`}>
      {config.description && (
        <Typography variant="body2" color="text.secondary">
          {config.description}
          {config.required && (
            <Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
              *
            </Typography>
          )}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        {INTRO_TEXT}
      </Typography>

      <Box>
        <ServiceSelector
          multiple
          organizationId={context.organizationId}
          projectId={context.projectId}
          value={selectedServiceIds}
          onChange={handleSelectorChange}
          disabled={isLocked}
          label="Services"
          placeholder="Select services"
          helperText="Select the services used in this plan"
        />
        <Box sx={{ mt: 1, display: "flex", justifyContent: "flex-start" }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={handleCreateService}
            disabled={isLocked || !modalService}
          >
            Create service
          </Button>
        </Box>
      </Box>

      <PlanGapsAddedExistingList
        items={fieldValue.services}
        isLocked={isLocked}
        organizationId={context.organizationId}
        projectId={context.projectId}
        onRemove={handleRemoveService}
      />
    </Stack>
  );
};
