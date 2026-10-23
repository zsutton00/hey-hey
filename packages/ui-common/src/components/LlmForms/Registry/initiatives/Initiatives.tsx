import AddIcon from "@mui/icons-material/Add";
import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  Typography,
} from "@mui/material";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  CreateInitiativeDto,
  InitiativeCreatorType,
  InitiativeResponseDto,
  GenerationSystemMessageData,
  Priority,
  WorkStatus,
} from "../../../../api";
import type { MutationCallbacks } from "../../../../data/core/types";
import { KEYS } from "../../../../i18n/keys";
import { contentToSectionInputs } from "../../../../utils/workItemSections";
import { WorkItemCard } from "../../../shared/WorkItemCard";
import {
  NewInitiativeModal,
  type NewInitiativeFormData,
} from "./NewInitiativeModal";

interface InitiativesMessageProps {
  data: GenerationSystemMessageData;
  response: string;
  onAcknowledge: () => void;
  isSubmitting: boolean;
  organizationId: string;
  reviewedInitiatives?: Set<string>;
  onInitiativeClick?: (initiative: InitiativeResponseDto) => void;
  onInitiativeCreate: (
    newInitiative: CreateInitiativeDto,
    callbacks?: MutationCallbacks<InitiativeResponseDto>
  ) => Promise<InitiativeResponseDto>;
  onInitiativeDelete?: (initiative: InitiativeResponseDto) => void;
  onInitiativeReject?: (initiative: InitiativeResponseDto) => void;
  initiatives: InitiativeResponseDto[];
  projectId: string;
  conversationId: string;
  onInitiativeCreated?: () => Promise<void>;
}

export const Initiatives: React.FC<InitiativesMessageProps> = ({
  data,
  response,
  onAcknowledge: _onAcknowledge,
  isSubmitting: _isSubmitting,
  reviewedInitiatives = new Set(),
  organizationId,
  onInitiativeClick,
  onInitiativeDelete,
  onInitiativeReject,
  projectId,
  initiatives,
  onInitiativeCreate,
  conversationId,
  onInitiativeCreated,
}) => {
  const { t } = useTranslation();

  // Modal state management
  const [isNewInitiativeModalOpen, setIsNewInitiativeModalOpen] =
    useState(false);

  // Use initiatives hook for creation
  const [isCreatingInitiative, setIsCreatingInitiative] = useState(false);
  // Modal event handlers
  const handleNewInitiativeClick = useCallback(() => {
    setIsNewInitiativeModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsNewInitiativeModalOpen(false);
  }, []);

  const handleSubmitNewInitiative = useCallback(
    async (formData: NewInitiativeFormData) => {
      setIsCreatingInitiative(true);
      try {
        await onInitiativeCreate(
          {
            name: formData.name.trim(),
            projectId,
            sections: contentToSectionInputs(
              {
                description: formData.description ?? "",
                acceptanceCriteria: "",
              },
              { includeEmpty: false }
            ),
            status: "REFINING_DESCRIPTION" as WorkStatus,
            priority: "MEDIUM" as Priority,
            creatorType: "USER" as InitiativeCreatorType,
            tags: formData.tags,
            sourceConversationId: formData.conversationId,
          },
          {
            onSuccess: async () => {
              setIsNewInitiativeModalOpen(false);
              // Refresh the initiatives list
              if (onInitiativeCreated) {
                await onInitiativeCreated();
              }
            },
            onError: (error) => {
              console.error("Failed to create initiative:", error);
            },
          }
        );
      } finally {
        setIsCreatingInitiative(false);
      }
    },
    [onInitiativeCreate, onInitiativeCreated]
  );

  // Data loading is now handled by the parent component via TanStack Query

  // Loading and error states are now handled by the parent component

  return (
    <Card sx={{ mt: 2, ":hover": { transform: "none", boxShadow: 1 } }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t(KEYS.initiatives.title)}
        </Typography>

        {/* Response message */}
        <Typography variant="body1" sx={{ mb: 3 }}>
          {response}
        </Typography>

        {/* Summary */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          {data.summary && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" gutterBottom>
                {t(KEYS.initiatives.summary)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("initiatives.totalCount", {
                  count: data.summary.totalInitiatives,
                })}
              </Typography>
            </Box>
          )}
          {/* New Initiative Button */}
          <Box sx={{ mb: 2, display: "flex", justifyContent: "flex-start" }}>
            <Button
              startIcon={<AddIcon />}
              onClick={handleNewInitiativeClick}
              color="actionable"
              variant="contained"
              size="small"
              sx={{
                padding: "0 24px",
                height: 40,
              }}
              disabled={isCreatingInitiative}
            >
              {t(KEYS.initiatives.create)}
            </Button>
          </Box>
        </Box>

        {/* Initiatives grid */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {initiatives.map((initiative) => (
            <Grid size={{ xs: 12 }} key={initiative.id}>
              <WorkItemCard
                workType="workstream"
                item={initiative}
                isReviewed={reviewedInitiatives.has(initiative.id)}
                onRefine={onInitiativeClick || (() => {})}
                onReject={
                  onInitiativeReject || onInitiativeDelete || (() => {})
                }
              />
            </Grid>
          ))}
        </Grid>

        {/* New Initiative Modal */}
        <NewInitiativeModal
          open={isNewInitiativeModalOpen}
          organizationId={organizationId}
          onClose={handleCloseModal}
          onSubmit={handleSubmitNewInitiative}
          isLoading={isCreatingInitiative}
          conversationId={conversationId}
        />
      </CardContent>
    </Card>
  );
};
