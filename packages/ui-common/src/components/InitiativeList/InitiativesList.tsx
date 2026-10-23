import { Paper } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";
import type { InitiativeResponseDto, TargetEntityType } from "../../api";
import { usePathService } from "../../contexts";
import { KEYS } from "../../i18n";
import { EntityListItem, EntityGrid, initiativeAdapter } from "../Entity";
import { InteractionComponent } from "../InteractionComponent";

interface InitiativesListProps {
  initiatives: InitiativeResponseDto[];
  projectId: string;
  isLoading?: boolean;
  searchTerm?: string;
}

export const InitiativesList: React.FC<InitiativesListProps> = ({
  initiatives,
  projectId,
  isLoading = false,
  searchTerm = "",
}) => {
  const { t } = useTranslation();
  const pathService = usePathService();

  // Determine empty message based on search state
  const emptyMessage = searchTerm
    ? "No initiatives match your search"
    : t(KEYS.initiatives.noInitiatives);

  return (
    <Paper
      sx={{ mt: 2, p: 3, backgroundColor: "rgb(249, 249, 251)", width: "100%" }}
    >
      <EntityGrid
        items={initiatives}
        loading={isLoading}
        renderItem={(initiative) => {
          const props = initiativeAdapter.toEntityListItemProps(initiative, {
            projectId,
            pathService,
          });
          return (
            <InteractionComponent
              entityId={initiative.id}
              entityType={"INITIATIVE" as TargetEntityType}
              hasProposalSupport
              organizationId={initiative.organizationId}
              projectId={projectId}
              entityTitle={initiative.name}
            >
              <EntityListItem {...props} />
            </InteractionComponent>
          );
        }}
        keyExtractor={(initiative) => initiative.id}
        emptyMessage={emptyMessage}
      />
    </Paper>
  );
};
