import type { ModalConfig } from "@hey-hey/ui-common/context";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import React from "react";
import { AdvancedSearch } from "@hey-hey/ui-common/components/AdvancedSearch";
import type { SearchEntity } from "@hey-hey/ui-common/components/AdvancedSearch";
import { CreateDocumentContent } from "@hey-hey/ui-common/components/DesignDoc";
import { EntityIcon } from "@hey-hey/ui-common/components/Entity";
import { EntityPreview } from "@hey-hey/ui-common/components/shared/EntityPreview";
import { EntityViewerLoader } from "@hey-hey/ui-common/components/EntityViewer";
import { SuggestedActionTaskModal } from "@hey-hey/ui-common/components/Modals";
import { ProjectContext, ModalType } from "@hey-hey/ui-common/context";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import {
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useActiveProjectId } from "../hooks";
import { CreateServiceModal } from "./CreateServiceModal";
import { SearchInputsSurface } from "./SearchInputsSurface";

type RelatedEntityItem = {
  entityId: string;
  entityType: string;
  entityName: string;
};

type EntityListItem = RelatedEntityItem | SearchEntity;

const isRelatedEntityItem = (
  entity: EntityListItem,
): entity is RelatedEntityItem => "entityId" in entity;

const getEntitySummary = (entity: EntityListItem) => {
  if (isRelatedEntityItem(entity)) {
    return {
      id: entity.entityId,
      type: entity.entityType,
      name: entity.entityName,
    };
  }

  return {
    id: entity.id,
    type: entity.type,
    name: entity.name,
  };
};

/**
 * Modal renderer for the Hey Hey application
 *
 * Renders one retained configuration. The dispatcher owns its lifetime;
 * minimization does not clear its configuration or its content.
 */
export function HeyHeyModalInstance({
  currentModal,
  closeModal,
}: {
  currentModal: ModalConfig;
  closeModal: () => void;
}): React.ReactElement | null {
  const projectId = useActiveProjectId();
  const { currentOrgId } = useUserIdentity() || {};
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [previewEntity, setPreviewEntity] =
    React.useState<EntityListItem | null>(null);
  const [searchHasContent, setSearchHasContent] = React.useState(false);

  React.useEffect(() => {
    if (currentModal?.type !== ModalType.ENTITY_LIST) {
      setPreviewEntity(null);
    }
    if (currentModal?.type !== ModalType.ADVANCED_SEARCH) {
      setSearchHasContent(false);
    }
  }, [currentModal?.type]);

  if (!projectId) {
    console.warn("HeyHeyModal: projectId not available");
    return null;
  }

  const projectContextValue = currentOrgId
    ? { organizationId: currentOrgId, projectId, navigate }
    : null;

  const renderModal = (): React.ReactElement | null => {
    switch (currentModal.type) {
      case ModalType.ADVANCED_SEARCH:
        return (
          <Dialog
            workTitle="Search"
            open
            onClose={closeModal}
            maxWidth={searchHasContent ? "lg" : "md"}
            fullWidth
            slotProps={{
              paper: {
                sx: {
                  height: searchHasContent ? "80vh" : undefined,
                  transition: "all 0.2s ease",
                },
              },
            }}
          >
            <SearchInputsSurface sx={{ height: "100%" }}>
              <AdvancedSearch
                {...currentModal}
                defaultQuery={currentModal.defaultQuery}
                projectId={projectId}
                onClose={closeModal}
                onHasContent={setSearchHasContent}
              />
            </SearchInputsSurface>
          </Dialog>
        );

      case ModalType.SUGGESTED_ACTION_TASK:
        return (
          <SuggestedActionTaskModal
            open
            onClose={closeModal}
            {...currentModal}
            onSubmit={(data) => {
              currentModal.onSubmit(data);
              closeModal();
            }}
          />
        );

      case ModalType.CREATE_DOCUMENT:
        return (
          <Dialog open onClose={closeModal} fullWidth maxWidth="md">
            <DialogTitle>
              {t("documents.createDocument", "Create Document")}
            </DialogTitle>
            <DialogContent>
              <CreateDocumentContent {...currentModal} onClose={closeModal} />
            </DialogContent>
          </Dialog>
        );

      case ModalType.CREATE_SERVICE:
        return (
          <CreateServiceModal
            open
            organizationId={currentModal.organizationId}
            projectId={currentModal.projectId}
            onClose={() => {
              currentModal.onClose?.();
              closeModal();
            }}
            onSuccess={currentModal.onSuccess}
          />
        );

      case ModalType.CONFIRMATION:
        // TODO: Implement confirmation modal
        return null;

      case ModalType.ENTITY_LIST: {
        const entities = currentModal.entities as EntityListItem[];
        const allowPreview = currentModal.showPreview ?? true;
        const hasSelection = Boolean(currentModal.onSelect);
        const isClickable = allowPreview || hasSelection;
        const handleClose = () => {
          setPreviewEntity(null);
          currentModal.onClose?.();
          closeModal();
        };
        const handleSelect = (entity: EntityListItem) => {
          currentModal.onSelect?.(entity);
          handleClose();
        };
        const handleItemClick = (entity: EntityListItem) => {
          if (allowPreview) {
            setPreviewEntity(entity);
            return;
          }

          if (hasSelection) {
            handleSelect(entity);
          }
        };

        return (
          <Dialog open onClose={handleClose} fullWidth maxWidth="sm">
            <DialogTitle>{currentModal.title}</DialogTitle>
            <DialogContent sx={{ p: previewEntity ? 0 : 2 }}>
              {previewEntity ? (
                currentOrgId ? (
                  <EntityPreview
                    entity={previewEntity}
                    organizationId={currentOrgId}
                    projectId={projectId}
                    onClose={() => setPreviewEntity(null)}
                    secondaryAction={
                      currentModal.onSelect
                        ? {
                            label: "Select",
                            onClick: () => handleSelect(previewEntity),
                          }
                        : undefined
                    }
                  />
                ) : (
                  <Typography color="text.secondary">
                    Organization context unavailable for preview.
                  </Typography>
                )
              ) : entities.length > 0 ? (
                <List disablePadding>
                  {entities.map((entity) => {
                    const { id, type, name } = getEntitySummary(entity);
                    return (
                      <ListItem
                        key={id}
                        disablePadding={isClickable}
                        sx={{ py: allowPreview ? 0 : 1 }}
                      >
                        {isClickable ? (
                          <ListItemButton
                            onClick={() => handleItemClick(entity)}
                          >
                            <ListItemIcon sx={{ minWidth: 40 }}>
                              <EntityIcon entityType={type} size={24} />
                            </ListItemIcon>
                            <ListItemText primary={name} secondary={type} />
                          </ListItemButton>
                        ) : (
                          <>
                            <ListItemIcon sx={{ minWidth: 40 }}>
                              <EntityIcon entityType={type} size={24} />
                            </ListItemIcon>
                            <ListItemText primary={name} secondary={type} />
                          </>
                        )}
                      </ListItem>
                    );
                  })}
                </List>
              ) : (
                <Typography color="text.secondary">
                  No entities available.
                </Typography>
              )}
            </DialogContent>
          </Dialog>
        );
      }

      case ModalType.ENTITY_DETAIL: {
        const entityId =
          currentModal.source === "lookup"
            ? currentModal.entityId
            : currentModal.entity.id;

        return (
          <Dialog
            workTitle="Entity details"
            open
            onClose={closeModal}
            fullWidth
            maxWidth="sm"
          >
            <DialogContent>
              <EntityViewerLoader
                source="lookup"
                entityType={currentModal.entityType}
                entityId={entityId}
                organizationId={currentModal.organizationId}
                projectId={currentModal.projectId}
              />
            </DialogContent>
          </Dialog>
        );
      }

      case ModalType.FORM:
        // TODO: Implement form modal
        return null;

      default:
        console.warn("HeyHeyModal: Unknown modal type", currentModal);
        return null;
    }
  };

  return (
    <ProjectContext.Provider value={projectContextValue}>
      {renderModal()}
    </ProjectContext.Provider>
  );
}
