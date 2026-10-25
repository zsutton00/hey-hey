import { useModalState } from "@hey-hey/ui-common/components/Modals";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import { WebPathService } from "@hey-hey/ui-common";
import { TERMS } from "@hey-hey/ui-common/i18n";
import {
  CapsuleAction,
  DesignDocMetadata,
  DesignDocReadView,
  DiscussCapsuleAction,
  InteractionComponent,
  useTaskGenerationCapsuleAction,
} from "@hey-hey/ui-common/components";
import {
  CanonicalPageBoundary,
  createCanonicalPageDescriptor,
  type CanonicalPageComposition,
  TrackingProvider,
} from "@hey-hey/ui-common/context";
import {
  useDeleteDesignDoc,
  useDesignDoc,
  useFullEntityContext,
  useProject,
  useUpdateDesignDoc,
} from "@hey-hey/ui-common/data";
import type { AgentSessionDto } from "@hey-hey/ui-common/api";
import ArchiveIcon from "@mui/icons-material/Archive";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EditIcon from "@mui/icons-material/Edit";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import {
  type AdrStatus,
  type BrainstormStatus,
  type ContextRelatedEntityDto,
  DesignDocTemplate,
  EntityType,
  TargetEntityType,
} from "@hey-hey/ui-common/api";
import TasksIcon from "@mui/icons-material/Assignment";
import {
  DetailPageBody,
  DetailPageContainer,
  DetailPageHeader,
  DetailPageTabs,
  type DetailPageTab,
} from "../../components/Layout";
import { ContextRailCards } from "../../components/ContextRailCards";
import { AdminTab, buildAdminMetadataItems } from "../../components/Tabs";
import { AgentSessionsTab } from "../../components/Tabs/AgentSessionsTab";
import { ConversationListTab } from "../../components/Tabs/ConversationListTab";
import { DesignDocsTab } from "../../components/Tabs/DesignDocsTab";
import { isDesignDocRefining } from "../../utils/statusUtils";
import { DesignDocBreadcrumbs } from "./DesignDocBreadcrumbs";
import { DesignDocTasksTab } from "./DesignDocTasksTab";
import { DocumentEditor } from "./DocumentEditor";
import { SetReadyActionCapsule } from "./SetReadyActionCapsule";

interface DocumentPageProps {
  organizationId: string;
  projectId: string;
  documentId: string;
  preview?: boolean;
}

const DocumentPage: React.FC<DocumentPageProps> = ({
  organizationId: currentOrgId,
  projectId,
  documentId,
  preview = false,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Edit/read mode state
  const [isEditing, setIsEditing] = useState<boolean | null>(null);
  const [isContextualRailVisible, setIsContextualRailVisible] = useState(true);
  const previousRefiningStateRef = useRef<boolean | null>(null);

  const [
    confirmArchiveOpen,
    setConfirmArchiveOpen,
    confirmArchiveOpenOwnerKey,
  ] = useModalState(false);
  const [isSubmittingAdminAction, setIsSubmittingAdminAction] = useState(false);

  // Tab state management
  const [routeActiveTab, setRouteActiveTab] = useQueryState(
    "tab",
    parseAsStringLiteral([
      "document",
      "tasks",
      "linked",
      "sessions",
      "conversations",
      "admin",
    ] as const).withDefault("document"),
  );
  const [previewActiveTab, setPreviewActiveTab] =
    useState<typeof routeActiveTab>("document");
  const activeTab = preview ? previewActiveTab : routeActiveTab;
  const setActiveTab = useCallback(
    (
      value: Parameters<typeof setRouteActiveTab>[0],
      options?: Parameters<typeof setRouteActiveTab>[1],
    ) => {
      if (preview) {
        setPreviewActiveTab((previous) => {
          const next = typeof value === "function" ? value(previous) : value;
          return next ?? "document";
        });
        return;
      }
      return setRouteActiveTab(value, options);
    },
    [preview, setRouteActiveTab],
  );

  // Fetch document data
  const {
    data: documentData,
    isLoading: isLoadingDocument,
    error: loadError,
  } = useDesignDoc(currentOrgId, documentId, {
    enabled: !!documentId,
  });

  const { data: project } = useProject(currentOrgId || "", projectId || "", {
    enabled: !!currentOrgId && !!projectId,
    preferStale: true,
  });
  const { mutate: updateDesignDoc, isPending: isUpdatingDesignDoc } =
    useUpdateDesignDoc();
  const { mutate: deleteDesignDoc } = useDeleteDesignDoc();

  const { data: fullContext, isLoading: isLoadingContext } =
    useFullEntityContext({
      organizationId: currentOrgId ?? "",
      projectId: projectId ?? "",
      entityType: EntityType.DesignDoc,
      entityId: documentId ?? "",
      enabled: !!currentOrgId && !!projectId && !!documentId,
    });

  const linkedTasks: ContextRelatedEntityDto[] = (
    fullContext?.relatedEntities ?? []
  ).filter((entity) => entity.entityType === EntityType.Task);

  // Initialize isEditing based on document status or ?editing=true param
  useEffect(() => {
    if (isEditing === null && documentData) {
      const editingParam = preview
        ? null
        : new URLSearchParams(location.search).get("editing");
      setIsEditing(
        editingParam === "true" || isDesignDocRefining(documentData),
      );
    }
  }, [isEditing, documentData, location.search, preview]);

  // Auto-exit edit mode when status transitions from refining → ready/review
  useEffect(() => {
    if (!documentData) return;

    const currentRefiningState = isDesignDocRefining(documentData);

    if (
      isEditing &&
      previousRefiningStateRef.current === true &&
      currentRefiningState === false
    ) {
      setIsEditing(false);
    }

    previousRefiningStateRef.current = currentRefiningState;
  }, [documentData, isEditing]);

  const handleBack = () => {
    navigate(`/projects/${projectId}/documents`);
  };

  const handleEdit = useCallback(() => {
    setIsEditing((prev) => !prev);
    setActiveTab("document");
  }, [setActiveTab]);

  const handleToggleContextualRail = useCallback(() => {
    setIsContextualRailVisible((previous) => !previous);
  }, []);

  const handleDoneEditing = useCallback(
    (completedDesignDocId: string) => {
      if (completedDesignDocId !== documentId) {
        return;
      }

      setIsEditing(false);
      if (preview) {
        return;
      }

      const searchParams = new URLSearchParams(location.search);
      searchParams.delete("editing");
      navigate(
        {
          pathname: location.pathname,
          search: searchParams.toString(),
        },
        { replace: true },
      );
    },
    [documentId, location.pathname, location.search, navigate, preview],
  );

  const handleArchiveClick = useCallback(() => {
    setConfirmArchiveOpen(true);
  }, []);

  const handleCancelArchive = useCallback(() => {
    if (isSubmittingAdminAction) return;
    setConfirmArchiveOpen(false);
  }, [isSubmittingAdminAction]);

  const handleConfirmArchive = useCallback(async () => {
    if (!currentOrgId || !documentData) return;
    try {
      setIsSubmittingAdminAction(true);
      await deleteDesignDoc({
        organizationId: currentOrgId,
        designDocId: documentData.id,
      });
      setConfirmArchiveOpen(false);
      navigate(`/projects/${projectId}/documents`);
    } catch (error) {
      console.error("Failed to archive design doc:", error);
    } finally {
      setIsSubmittingAdminAction(false);
    }
  }, [currentOrgId, deleteDesignDoc, documentData, navigate, projectId]);

  const handleStatusChange = useCallback(
    (status: AdrStatus) => {
      if (!currentOrgId || !documentData) {
        return;
      }

      updateDesignDoc({
        organizationId: currentOrgId,
        designDocId: documentData.id,
        updates: { status },
      });
    },
    [currentOrgId, documentData, updateDesignDoc],
  );

  const handleTagsChange = useCallback(
    (tags: string[]) => {
      if (!currentOrgId || !documentData) {
        return;
      }

      updateDesignDoc({
        organizationId: currentOrgId,
        designDocId: documentData.id,
        updates: { tags },
      });
    },
    [currentOrgId, documentData, updateDesignDoc],
  );

  const conversationPathForId = useCallback(
    (conversationId: string) =>
      WebPathService.conversation({ projectId: projectId!, conversationId }),
    [projectId],
  );

  const handleAgentSessionCreated = useCallback(
    (session: AgentSessionDto) => {
      navigate(
        WebPathService.designDocAgentSession({
          projectId: projectId!,
          designDocId: documentId!,
          agentSessionId: session.id,
        }),
      );
    },
    [navigate, projectId, documentId],
  );

  const buildAgentSessionPath = useCallback(
    (agentSessionId: string) =>
      WebPathService.designDocAgentSession({
        projectId: projectId!,
        designDocId: documentId!,
        agentSessionId,
      }),
    [projectId],
  );

  const taskGenerationAction = useTaskGenerationCapsuleAction({
    aboutId: documentId!,
    aboutType: "design-doc",
    aboutTitle: documentData?.name,
    projectId: projectId!,
    organizationId: currentOrgId!,
    status: documentData?.status,
    actionId: "tasks-from-adr",
    label: TERMS.Tasks,
    title: "adr.taskGeneration.title",
  });

  // Loading state
  if (isLoadingDocument) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "400px",
          p: 4,
          gap: 2,
        }}
      >
        <CircularProgress size={40} />
        <Typography variant="h6" color="text.secondary">
          {t("documents.loadingDocument", "Loading document...")}
        </Typography>
      </Box>
    );
  }

  // Error state
  if (loadError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {t("documents.loadError", "Failed to load document: {{error}}", {
            error: (loadError as Error).message,
          })}
        </Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={handleBack}>
          {t("common.back", "Back to Documents")}
        </Button>
      </Box>
    );
  }

  // Prepare tabs data
  const tasksTabLabel =
    linkedTasks.length > 0
      ? `${TERMS.Tasks} (${linkedTasks.length})`
      : TERMS.Tasks;
  const tabs: DetailPageTab[] = [
    { value: "document", label: "Document" },
    { value: "tasks", label: tasksTabLabel },
    { value: "linked", label: "Linked Documents" },
    { value: "sessions", label: "Agent Sessions" },
    { value: "conversations", label: "Conversations" },
    { value: "admin", label: "Admin" },
  ];

  const adminMetadataItems = buildAdminMetadataItems({
    createdAt: documentData?.createdAt,
    updatedAt: documentData?.updatedAt,
  });

  if (!documentData || !currentOrgId || !projectId) {
    return null;
  }

  const metadataTemplate =
    documentData.template === DesignDocTemplate.Classic ||
    documentData.template === DesignDocTemplate.Rfc
      ? DesignDocTemplate.Brainstorm
      : documentData.template;

  const isRefining = isDesignDocRefining(documentData);
  const pageComposition: CanonicalPageComposition = preview
    ? { kind: "observational" }
    : {
        kind: "canonical",
        descriptor: createCanonicalPageDescriptor(
          "design_doc",
          documentData.id,
          null,
          { kind: "design_doc", label: documentData.name },
        ),
      };

  return (
    <TrackingProvider
      context={{
        page: {
          name: "design-doc",
          path: WebPathService.designDoc({
            projectId,
            designDocId: documentData.id,
          }),
        },
        designDoc: {
          id: documentData.id,
          name: documentData.name,
        },
        attentionEntity: preview
          ? undefined
          : {
              id: documentData.id,
              type: "design_doc",
              name: documentData.name,
              status: documentData.status,
              projectId,
            },
      }}
    >
      <CanonicalPageBoundary composition={pageComposition}>
        {activeTab === "document" && !isEditing && !isRefining && (
          <CapsuleAction
            id="edit-design-doc"
            label={t("common.edit", "Edit")}
            icon={EditIcon}
            actionGroup="page"
            tier="page"
            order={100}
            behavior="click"
            onClick={handleEdit}
            disabled={isUpdatingDesignDoc}
            iconStyle={{ backgroundColor: "#2563EB", color: "#fff" }}
          />
        )}
        {activeTab === "document" && (
          <SetReadyActionCapsule
            organizationId={currentOrgId}
            designDocId={documentData.id}
            status={documentData.status}
            disabled={isUpdatingDesignDoc}
          />
        )}
        {activeTab === "document" && !isEditing && !isRefining && (
          <DiscussCapsuleAction
            entityId={documentData.id}
            entityType={TargetEntityType.DesignDoc}
            entityTitle={documentData.name}
            organizationId={currentOrgId}
            projectId={projectId}
          />
        )}
        {!preview && (
          <DesignDocBreadcrumbs
            organizationId={currentOrgId}
            projectId={projectId}
            projectName={project?.name}
            designDoc={documentData}
          />
        )}
        <DetailPageContainer>
          <InteractionComponent
            draggable={false}
            disablePreview={true}
            entityId={documentData.id}
            entityType={TargetEntityType.DesignDoc}
            hasProposalSupport={
              activeTab === "document" && !isEditing && !isRefining
            }
            organizationId={currentOrgId}
            projectId={projectId}
            entityTitle={documentData.name}
            size="medium"
            indicatorPlacement="bottom-left"
          >
            <DetailPageHeader
              title={documentData.name || "Untitled Document"}
              metadataComponent={
                <DesignDocMetadata
                  status={documentData.status as BrainstormStatus}
                  tags={documentData.tags ?? []}
                  onStatusChange={handleStatusChange}
                  onTagsChange={handleTagsChange}
                  disabled={isUpdatingDesignDoc}
                  size="small"
                  template={metadataTemplate}
                />
              }
            />
            {!isRefining && (
              <DetailPageTabs
                value={activeTab}
                onChange={setActiveTab}
                tabs={tabs}
              />
            )}

            {/* Document Tab */}
            {activeTab === "document" && (
              <DetailPageBody
                widthStrategy="equal-split"
                gap={0}
                sidebarSide="right"
                contextualRail={
                  !isEditing
                    ? {
                        id: `design-doc-contextual-rail-${documentData.id}`,
                        label: "Related items",
                        expanded: isContextualRailVisible,
                        onToggle: handleToggleContextualRail,
                      }
                    : undefined
                }
                panePadding={
                  isEditing
                    ? undefined
                    : {
                        content: { p: 3, pb: 6 },
                        sidebar: {
                          alignSelf: "stretch",
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                          p: 3,
                        },
                      }
                }
                content={
                  isEditing ? (
                    <DocumentEditor
                      currentOrgId={currentOrgId}
                      projectId={projectId}
                      documentData={documentData}
                      status={documentData.status}
                      onDone={handleDoneEditing}
                    />
                  ) : (
                    <DesignDocReadView
                      title={documentData.name}
                      summary={documentData.summary}
                      sections={documentData.sections}
                      status={documentData.status}
                      alignmentCheck={{
                        organizationId: currentOrgId,
                        projectId,
                        designDocId: documentData.id,
                        onSessionCreated: handleAgentSessionCreated,
                        buildSessionPath: buildAgentSessionPath,
                      }}
                    />
                  )
                }
                sidebar={
                  isEditing ? null : (
                    <Stack spacing={2}>
                      <ContextRailCards
                        proposals={fullContext?.proposals ?? []}
                        relatedEntities={fullContext?.relatedEntities ?? []}
                        organizationId={currentOrgId}
                        projectId={projectId}
                        conversationPathForId={conversationPathForId}
                        dataTestIdPrefix="design-doc"
                      />
                    </Stack>
                  )
                }
              />
            )}

            {/* Tasks Tab */}
            {activeTab === "tasks" && (
              <DetailPageBody
                sidebar={null}
                content={
                  <DesignDocTasksTab
                    projectId={projectId}
                    tasks={linkedTasks}
                    isLoading={isLoadingContext}
                  />
                }
              />
            )}

            {/* Linked Documents Tab */}
            {activeTab === "linked" && (
              <DetailPageBody
                sidebar={null}
                content={
                  <DesignDocsTab
                    organizationId={currentOrgId}
                    projectId={projectId}
                    designDocId={documentData.id}
                    enableFilters={true}
                    emptyMessage="No linked documents found."
                  />
                }
              />
            )}

            {/* Agent Sessions Tab */}
            {activeTab === "sessions" && (
              <DetailPageBody
                sidebar={null}
                content={
                  <AgentSessionsTab
                    organizationId={currentOrgId}
                    projectId={projectId}
                    designDocId={documentData.id}
                    enableFilters={true}
                    emptyMessage="No coding sessions linked to this design document yet."
                  />
                }
              />
            )}

            {/* Conversations Tab */}
            {activeTab === "conversations" && (
              <DetailPageBody
                sidebar={null}
                content={
                  <ConversationListTab
                    organizationId={currentOrgId}
                    projectId={projectId}
                    entityName={documentData.name}
                    workflowAboutId={documentData.id}
                    workflowAboutType="design-doc"
                    conversationPathForId={conversationPathForId}
                  />
                }
              />
            )}

            {activeTab === "admin" && (
              <DetailPageBody
                sidebar={null}
                content={
                  <AdminTab
                    metadataItems={adminMetadataItems}
                    actions={
                      <Button
                        startIcon={<ArchiveIcon />}
                        onClick={handleArchiveClick}
                        variant="outlined"
                        disabled={isSubmittingAdminAction || isLoadingDocument}
                        size="small"
                        data-testid="design-doc-archive-button"
                      >
                        {t("documents.admin.archive", "Archive")}
                      </Button>
                    }
                  />
                }
              />
            )}
          </InteractionComponent>
          {documentData.status === "READY" && (
            <CapsuleAction
              id={taskGenerationAction.actionId}
              label={t(taskGenerationAction.label)}
              icon={TasksIcon}
              behavior="expand"
              tier="page"
              order={1}
              inProgress={taskGenerationAction.inProgress}
              renderContent={taskGenerationAction.renderContent}
              title={t(taskGenerationAction.title)}
              menuItems={taskGenerationAction.menuItems}
              resumable={taskGenerationAction.resumable}
              expandable={taskGenerationAction.expandable}
            />
          )}
          <Dialog
            ownerKey={confirmArchiveOpenOwnerKey}
            open={confirmArchiveOpen}
            onClose={handleCancelArchive}
            maxWidth="sm"
            fullWidth
          >
            <DialogTitle>
              {t("documents.admin.archiveTitle", "Archive Document")}
            </DialogTitle>
            <DialogContent>
              <DialogContentText>
                {t(
                  "documents.admin.archiveConfirm",
                  "Are you sure you want to archive this document? It will be marked as archived and will no longer appear in active document lists.",
                )}
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button
                onClick={handleCancelArchive}
                disabled={isSubmittingAdminAction}
              >
                {t("common.cancel", "Cancel")}
              </Button>
              <Button
                onClick={handleConfirmArchive}
                variant="contained"
                color="primary"
                disabled={isSubmittingAdminAction}
                autoFocus
                data-testid="design-doc-admin-confirm-button"
              >
                {t("documents.admin.archive", "Archive")}
              </Button>
            </DialogActions>
          </Dialog>
        </DetailPageContainer>
      </CanonicalPageBoundary>
    </TrackingProvider>
  );
};

DocumentPage.displayName = "DocumentPage";

export { DocumentPage };
