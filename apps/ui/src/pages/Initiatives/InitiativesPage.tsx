import { useModalState } from "@hey-hey/ui-common/components/Modals";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import {
  InitiativesList,
  useFilteredWorkItems,
  WorkItemEntityFilters,
} from "@hey-hey/ui-common/components";
import { useInitiatives, useProject } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { compose, KEYS } from "@hey-hey/ui-common/i18n";
import { contentToSectionInputs } from "@hey-hey/ui-common/utils";
import AddIcon from "@mui/icons-material/Add";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import type {
  CreateInitiativeDto,
  InitiativeResponseDto,
  Priority,
  UpdateInitiativeDto,
  WorkStatus,
} from "@hey-hey/ui-common/api";
import { PageBreadcrumbs } from "../../components/Layout";

interface InitiativeFormData {
  title: string;
  description: string;
  status: WorkStatus;
  priority: Priority;
  tags: string[];
}

export const InitiativesPage: React.FC = () => {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const { currentOrgId } = useUserIdentity() || {};

  // Unified data layer for initiatives
  const {
    initiatives,
    isLoading: loading,
    error,
    create,
    update,
  } = useInitiatives(currentOrgId || "", projectId!, undefined, {
    enabled: !!currentOrgId && !!projectId,
    includeDesignDocCounts: true,
    includeSectionKeys: ["description"],
  });

  const { data: project } = useProject(currentOrgId || "", projectId || "", {
    enabled: !!currentOrgId && !!projectId,
    preferStale: true,
  });

  // Filter states
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkStatus | "">("");
  const [sortBy, setSortBy] = useState("status");

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen, createDialogOpenOwnerKey] =
    useModalState(false);
  const [editDialogOpen, setEditDialogOpen, editDialogOpenOwnerKey] =
    useModalState(false);
  const [editingInitiative, setEditingInitiative] =
    useState<InitiativeResponseDto | null>(null);

  // Form states
  const [formData, setFormData] = useState<InitiativeFormData>({
    title: "",
    description: "",
    status: "REFINING_DESCRIPTION",
    priority: "MEDIUM",
    tags: [],
  });

  // Filtered and sorted initiatives
  const filteredAndSortedInitiatives = useFilteredWorkItems(
    initiatives,
    searchTerm,
    statusFilter,
    sortBy,
  );

  const handleCreateInitiative = async () => {
    if (!currentOrgId) return;

    const createDto: CreateInitiativeDto = {
      name: formData.title,
      projectId: projectId as string,
      status: formData.status,
      priority: formData.priority,
      tags: formData.tags,
      sections: contentToSectionInputs(
        {
          description: formData.description,
          acceptanceCriteria: "",
        },
        { includeEmpty: false },
      ),
    };

    create(createDto, {
      onSuccess: () => {
        setCreateDialogOpen(false);
        resetForm();
      },
      onError: (error) => {
        console.error("Failed to create initiative:", error);
      },
    });
  };

  const handleUpdateInitiative = async () => {
    if (!currentOrgId || !editingInitiative) return;

    const updateDto: UpdateInitiativeDto = {
      name: formData.title,
      status: formData.status,
      priority: formData.priority,
      tags: formData.tags,
      sections: contentToSectionInputs(
        {
          description: formData.description,
          acceptanceCriteria: "",
        },
        { includeEmpty: false },
      ),
    };

    update(editingInitiative.id, updateDto, {
      onSuccess: () => {
        setEditDialogOpen(false);
        setEditingInitiative(null);
        resetForm();
      },
      onError: (error) => {
        console.error("Failed to update initiative:", error);
      },
    });
  };

  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      status: "REFINING_DESCRIPTION",
      priority: "MEDIUM",
      tags: [],
    });
  };

  const handleCloseCreateDialog = () => {
    setCreateDialogOpen(false);
    resetForm();
  };

  const handleCloseEditDialog = () => {
    setEditDialogOpen(false);
    setEditingInitiative(null);
    resetForm();
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "40vh",
          gap: 2,
        }}
      >
        <CircularProgress />
        <Typography variant="body1" color="text.secondary">
          {t(KEYS.common.loading)}
        </Typography>
      </Box>
    );
  }

  if (!projectId) {
    return null;
  }

  return (
    <Box sx={{ p: 3 }} data-testid="initiatives">
      {/* Breadcrumbs */}
      <PageBreadcrumbs
        sx={{ mb: 3 }}
        items={[
          { label: "Projects", to: "/projects" },
          {
            label: project?.name ?? compose("{{term.Project}}"),
            to: `/projects/${projectId}`,
            type: project?.name ? "project" : undefined,
          },
          {
            label: t(KEYS.initiatives.title),
            isCurrent: true,
            type: "initiative",
          },
        ]}
      />

      {/* Page Header */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 3 }}
      >
        <Typography variant="h4">{t(KEYS.initiatives.title)}</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          {t(KEYS.initiatives.create)}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error instanceof Error
            ? error.message
            : "Failed to load initiatives"}
        </Alert>
      )}

      {/* Filters */}
      <WorkItemEntityFilters
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        sortBy={sortBy}
        onSortByChange={setSortBy}
      />

      {/* Initiatives List */}
      <Box
        sx={{
          "& > .MuiPaper-root": {
            backgroundColor: "background.default",
          },
        }}
      >
        <InitiativesList
          initiatives={filteredAndSortedInitiatives}
          projectId={projectId}
          isLoading={loading}
          searchTerm={searchTerm}
        />
      </Box>

      {/* Create Initiative Dialog */}
      <Dialog
        ownerKey={createDialogOpenOwnerKey}
        open={createDialogOpen}
        onClose={handleCloseCreateDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t(KEYS.initiatives.dialog.createTitle)}</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <TextField
              label={t(KEYS.initiatives.form.title)}
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              fullWidth
              required
            />
            <TextField
              label={t(KEYS.initiatives.form.description)}
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              fullWidth
              multiline
              rows={3}
            />
            <TextField
              label={t(KEYS.initiatives.form.priority)}
              value={formData.priority}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  priority: e.target.value as Priority,
                })
              }
              select
              slotProps={{ select: { native: true } }}
              fullWidth
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCreateDialog}>
            {t(KEYS.common.cancel)}
          </Button>
          <Button onClick={handleCreateInitiative} variant="contained">
            {t(KEYS.common.create)}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Initiative Dialog */}
      <Dialog
        ownerKey={editDialogOpenOwnerKey}
        open={editDialogOpen}
        onClose={handleCloseEditDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t(KEYS.initiatives.dialog.editTitle)}</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <TextField
              label={t(KEYS.initiatives.form.title)}
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              fullWidth
              required
            />
            <TextField
              label={t(KEYS.initiatives.form.description)}
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              fullWidth
              multiline
              rows={3}
            />
            <TextField
              label={t(KEYS.initiatives.form.status)}
              value={formData.status}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  status: e.target.value as WorkStatus,
                })
              }
              select
              slotProps={{ select: { native: true } }}
              fullWidth
            >
              <option value="REFINING_DESCRIPTION">Refining Description</option>
              <option value="REFINING_DETAILS">Refining Details</option>
              <option value="REFINING_ACCEPTANCE_CRITERIA">
                Refining Acceptance Criteria
              </option>
              <option value="ACTIVE">Active</option>
              <option value="ON_HOLD">On Hold</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </TextField>
            <TextField
              label={t(KEYS.initiatives.form.priority)}
              value={formData.priority}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  priority: e.target.value as Priority,
                })
              }
              select
              slotProps={{ select: { native: true } }}
              fullWidth
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEditDialog}>
            {t(KEYS.common.cancel)}
          </Button>
          <Button onClick={handleUpdateInitiative} variant="contained">
            {t(KEYS.common.save)} Changes
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
