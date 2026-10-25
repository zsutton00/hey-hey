import { useModalState } from "@hey-hey/ui-common/components/Modals";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import {
  ProposalDetail,
  type OnAppliedProposal,
} from "@hey-hey/ui-common/components";
import { proposalsClient } from "@hey-hey/ui-common/clients";
import {
  CanonicalPageBoundary,
  createCanonicalPageDescriptor,
  type CanonicalPageComposition,
  TrackingProvider,
} from "@hey-hey/ui-common/context";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { useProject } from "@hey-hey/ui-common/data";
import { compose } from "@hey-hey/ui-common/i18n";
import { WebPathService } from "@hey-hey/ui-common/services";
import DeleteIcon from "@mui/icons-material/Delete";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import React, { useMemo, useState } from "react";
import {
  DetailPageTabs,
  DetailPageBody,
  DetailPageContainer,
  PageBreadcrumbs,
} from "../../components/Layout";
import { AdminTab } from "../../components/Tabs";

const PROPOSAL_PAGE_TABS = ["review", "admin"] as const;
type ProposalPageTab = (typeof PROPOSAL_PAGE_TABS)[number];

const proposalRelatedQueryKey = (queryKey: readonly unknown[]): boolean => {
  const key = JSON.stringify(queryKey).toLowerCase();
  return /proposal|conversation|message/.test(key);
};

export interface ProposalDetailViewProps {
  organizationId: string;
  projectId: string;
  proposalId: string;
  initialEditing?: boolean;
  preview?: boolean;
  onApplied?: OnAppliedProposal;
}

export const ProposalDetailView: React.FC<ProposalDetailViewProps> = ({
  organizationId,
  projectId,
  proposalId,
  initialEditing = false,
  preview = false,
  onApplied,
}) => {
  const { data: project } = useProject(organizationId, projectId, {
    enabled: !!organizationId && !!projectId,
    preferStale: true,
  });
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useQueryState(
    "tab",
    parseAsStringLiteral(PROPOSAL_PAGE_TABS).withDefault("review"),
  );
  const [
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    isDeleteDialogOpenOwnerKey,
  ] = useModalState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [presentationLabel, setPresentationLabel] = useState<string>();
  const pageComposition = useMemo<CanonicalPageComposition>(
    () =>
      preview
        ? { kind: "observational" }
        : {
            kind: "canonical",
            descriptor: createCanonicalPageDescriptor(
              "proposal",
              proposalId,
              null,
              presentationLabel
                ? { kind: "proposal", label: presentationLabel }
                : undefined,
            ),
          },
    [presentationLabel, preview, proposalId],
  );

  const handleOpenDeleteDialog = (): void => {
    setDeleteError(null);
    setIsDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = (): void => {
    if (!isDeleting) {
      setIsDeleteDialogOpen(false);
      setDeleteError(null);
    }
  };

  const handleConfirmDelete = async (): Promise<void> => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await proposalsClient.deleteProposal({
        organizationId,
        projectId,
        proposalId,
      });
      setIsDeleteDialogOpen(false);
      await queryClient.invalidateQueries({
        predicate: (query) => proposalRelatedQueryKey(query.queryKey),
      });
    } catch (error: unknown) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed to delete proposal.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <TrackingProvider
      context={{
        page: {
          name: preview ? "proposal-preview" : "proposal",
          path: preview
            ? `/projects/${projectId}/proposals/${proposalId}/preview`
            : WebPathService.proposal({ projectId, proposalId }),
          section: preview ? "preview" : undefined,
        },
        attentionEntity: preview
          ? undefined
          : {
              id: proposalId,
              type: "proposal",
              projectId,
            },
      }}
    >
      <CanonicalPageBoundary composition={pageComposition}>
        {!preview && (
          <PageBreadcrumbs
            sx={{ mb: 2 }}
            items={[
              { label: "Projects", to: "/projects" },
              {
                label: project?.name ?? compose("{{term.Project}}"),
                to: `/projects/${projectId}`,
                type: project?.name ? "project" : undefined,
              },
              {
                label: "Proposals",
                to: `/projects/${projectId}/proposals`,
                type: "proposal",
              },
              { label: "Proposal", isCurrent: true, type: "proposal" },
            ]}
          />
        )}
        <DetailPageContainer>
          {!preview && (
            <DetailPageTabs<ProposalPageTab>
              value={activeTab}
              onChange={setActiveTab}
              tabs={[
                { value: "review", label: "Review" },
                { value: "admin", label: "Admin" },
              ]}
            />
          )}
          {preview || activeTab === "review" ? (
            <DetailPageBody
              sidebar={null}
              content={
                <ProposalDetail
                  proposalId={proposalId}
                  organizationId={organizationId}
                  projectId={projectId}
                  initialEditing={initialEditing}
                  onApplied={onApplied}
                  onPresentationLoaded={setPresentationLabel}
                />
              }
            />
          ) : (
            <AdminTab
              actions={
                <Button
                  startIcon={<DeleteIcon />}
                  onClick={handleOpenDeleteDialog}
                  variant="outlined"
                  color="error"
                  disabled={isDeleting}
                  size="small"
                  data-testid="proposal-delete-button"
                >
                  Delete
                </Button>
              }
            />
          )}
          {!preview && (
            <Dialog
              ownerKey={isDeleteDialogOpenOwnerKey}
              open={isDeleteDialogOpen}
              onClose={handleCloseDeleteDialog}
              maxWidth="sm"
              fullWidth
            >
              <DialogTitle>Delete proposal?</DialogTitle>
              <DialogContent>
                <DialogContentText>
                  This permanently deletes the proposal record. It does not
                  approve or apply a proposed delete action.
                </DialogContentText>
                {deleteError && <Alert severity="error">{deleteError}</Alert>}
              </DialogContent>
              <DialogActions>
                <Button onClick={handleCloseDeleteDialog} disabled={isDeleting}>
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmDelete}
                  variant="contained"
                  color="error"
                  disabled={isDeleting}
                  autoFocus
                  data-testid="proposal-admin-confirm-delete-button"
                >
                  Delete
                </Button>
              </DialogActions>
            </Dialog>
          )}
        </DetailPageContainer>
      </CanonicalPageBoundary>
    </TrackingProvider>
  );
};
