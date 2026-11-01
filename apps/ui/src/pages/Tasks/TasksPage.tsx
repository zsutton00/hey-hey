import { useModalState } from "@hey-hey/ui-common/components/Modals";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import type {
  CreateTaskDto,
  InitiativeResponseDto,
  Priority,
  TaskPriority,
  TaskResponseDto,
  UpdateTaskDto,
  WorkStatus,
} from "@hey-hey/ui-common/api";
import { KEYS, TERMS } from "@hey-hey/ui-common/i18n";

import { apiClient } from "@hey-hey/ui-common/clients";
import { TaskList } from "@hey-hey/ui-common/components";
import {
  useWorkItems,
  type WorkItemResponseDto,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { contentToSectionInputs } from "@hey-hey/ui-common/utils";
interface TaskFormData {
  title: string;
  description: string;
  status: WorkStatus;
  type: string;
  priority: Priority;
  estimatedHours: number;
  dependencies: string[];
  acceptanceCriteria: string[];
}

export const TasksPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId, initiativeId } = useParams<{
    projectId: string;
    initiativeId: string;
  }>();
  const { currentOrgId } = useUserIdentity() || {};

  const { updateTask } = useWorkItems(
    currentOrgId ?? "",
    "task",
    projectId ?? "",
    undefined,
    { enabled: false },
  );

  const [initiative, setInitiative] = useState<InitiativeResponseDto | null>(
    null,
  );
  const [tasks, setTasks] = useState<TaskResponseDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen, createDialogOpenOwnerKey] =
    useModalState(false);
  const [editDialogOpen, setEditDialogOpen, editDialogOpenOwnerKey] =
    useModalState(false);
  const [deleteDialogOpen, setDeleteDialogOpen, deleteDialogOpenOwnerKey] =
    useModalState(false);
  const [editingTask, setEditingTask] = useState<TaskResponseDto | null>(null);
  const [deletingTask, setDeletingTask] = useState<WorkItemResponseDto | null>(
    null,
  );

  // Form states
  const [formData, setFormData] = useState<TaskFormData>({
    title: "",
    description: "",
    status: "BACKLOG",
    type: "feature",
    priority: "MEDIUM",
    estimatedHours: 0,
    dependencies: [],
    acceptanceCriteria: [],
  });

  const loadInitiative = useCallback(async () => {
    if (!currentOrgId || !projectId || !initiativeId) return;

    try {
      const response = await apiClient.getInitiative({
        organizationId: currentOrgId,
        initiativeId,
      });
      const data = response.data.data;
      setInitiative(data || null);
    } catch (err: unknown) {
      console.error("Failed to load initiative:", err);
      setError(
        (err as { response?: { data?: { message: string } } })?.response?.data
          ?.message || "Failed to load initiative",
      );
    }
  }, [currentOrgId, projectId, initiativeId]);

  const loadTasks = useCallback(async () => {
    if (!currentOrgId || !projectId || !initiativeId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.getTasks({
        organizationId: currentOrgId,
        projectId,
      });
      setTasks(response.data.data || []);
    } catch (err: unknown) {
      console.error("Failed to load tasks:", err);
      setError(
        (err as { response?: { data?: { message: string } } })?.response?.data
          ?.message || `Failed to load ${TERMS.tasks}`,
      );
    } finally {
      setLoading(false);
    }
  }, [currentOrgId, projectId, initiativeId]);

  useEffect(() => {
    if (initiativeId) {
      loadInitiative();
      loadTasks();
    }
  }, [loadInitiative, loadTasks, initiativeId]);

  const handleCreateTask = async () => {
    if (!currentOrgId || !projectId || !initiativeId) return;

    try {
      const createDto = {
        initiativeId,
        title: formData.title,
        status: formData.status,
        type: formData.type,
        priority: formData.priority,
        estimatedHours: formData.estimatedHours,
        dependencies: formData.dependencies,
        sections: contentToSectionInputs(
          {
            description: formData.description,
            acceptanceCriteria: formData.acceptanceCriteria.join("\n"),
          },
          { includeEmpty: false },
        ),
      } as unknown as CreateTaskDto;

      await apiClient.createTask({
        organizationId: currentOrgId,
        projectId,
        createTaskDto: createDto,
      });

      setCreateDialogOpen(false);
      resetForm();
      loadTasks();
    } catch (err: unknown) {
      console.error("Failed to create task:", err);
      setError(
        (err as { response?: { data?: { message: string } } })?.response?.data
          ?.message || `Failed to create ${TERMS.task}`,
      );
    }
  };

  const handleUpdateTask = async () => {
    if (!currentOrgId || !projectId || !editingTask) return;

    try {
      const updateDto: UpdateTaskDto = {
        name: formData.title,
        status: formData.status,
        priority: formData.priority as TaskPriority,
        sections: contentToSectionInputs(
          {
            description: formData.description,
            acceptanceCriteria: formData.acceptanceCriteria.join("\n"),
          },
          { includeEmpty: false },
        ),
      };

      await updateTask(editingTask.id, updateDto, {
        authoritativeTask: editingTask,
      });

      setEditDialogOpen(false);
      setEditingTask(null);
      resetForm();
      loadTasks();
    } catch (err: unknown) {
      console.error("Failed to update task:", err);
      setError(
        (err as { response?: { data?: { message: string } } })?.response?.data
          ?.message || `Failed to update ${TERMS.task}`,
      );
    }
  };

  const handleDeleteTask = async () => {
    if (!currentOrgId || !projectId || !initiativeId || !deletingTask) return;

    try {
      await apiClient.removeTask({
        organizationId: currentOrgId,
        projectId,
        taskId: deletingTask?.id || "",
      });

      setDeleteDialogOpen(false);
      setDeletingTask(null);
      loadTasks();
    } catch (err: unknown) {
      console.error("Failed to delete task:", err);
      setError(
        (err as { response?: { data?: { message: string } } })?.response?.data
          ?.message || `Failed to delete ${TERMS.task}`,
      );
    }
  };

  const handleDeleteClick = (task: WorkItemResponseDto) => {
    setDeletingTask(task);
    setDeleteDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      status: "BACKLOG",
      type: "feature",
      priority: "MEDIUM",
      estimatedHours: 0,
      dependencies: [],
      acceptanceCriteria: [],
    });
  };

  const handleCloseCreateDialog = () => {
    setCreateDialogOpen(false);
    resetForm();
  };

  const handleCloseEditDialog = () => {
    setEditDialogOpen(false);
    setEditingTask(null);
    resetForm();
  };

  const handleCloseDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setDeletingTask(null);
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
          {t(KEYS.tasks.loading)}
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <Box sx={{ p: 3 }}>
        <Paper elevation={3} variant="banner" sx={{ mb: 3 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                <IconButton
                  onClick={() => navigate(`/projects/${projectId}/initiatives`)}
                  sx={{ mr: 1 }}
                >
                  <ArrowBackIcon />
                </IconButton>
                <Typography variant="h3">{TERMS.Tasks}</Typography>
              </Box>
              <Typography variant="h6">
                {initiative
                  ? `Managing ${TERMS.tasks} for: ${
                      initiative.name || "Untitled Initiative"
                    }`
                  : "Loading initiative..."}
              </Typography>
            </div>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateDialogOpen(true)}
              size="large"
            >
              New {TERMS.Task}
            </Button>
          </Box>
        </Paper>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <TaskList
          tasks={tasks}
          loading={loading}
          onDelete={handleDeleteClick}
          projectId={projectId as string}
          organizationId={currentOrgId}
          onCreateTask={() => setCreateDialogOpen(true)}
          showCreateButton={true}
          emptyMessage={`Create your first ${TERMS.task} to get started`}
        />

        {/* Create Task Dialog */}
        <Dialog
          ownerKey={createDialogOpenOwnerKey}
          open={createDialogOpen}
          onClose={handleCloseCreateDialog}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>{t(KEYS.tasks.dialog.createTitle)}</DialogTitle>
          <DialogContent>
            <Stack spacing={3} sx={{ mt: 1 }}>
              <TextField
                label="Title"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                fullWidth
                required
              />
              <TextField
                label="Description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                fullWidth
                multiline
                rows={3}
              />
              <TextField
                label="Status"
                value={formData.status}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    status: e.target.value as WorkStatus,
                  })
                }
                select
                SelectProps={{ native: true }}
                fullWidth
              >
                <option value="BACKLOG">Backlog</option>
                <option value="ACTIVE">Active</option>
                <option value="COMPLETED">Completed</option>
                <option value="ON_HOLD">On Hold</option>
                <option value="CANCELLED">Cancelled</option>
              </TextField>
              <TextField
                label="Type"
                value={formData.type}
                onChange={(e) =>
                  setFormData({ ...formData, type: e.target.value })
                }
                select
                SelectProps={{ native: true }}
                fullWidth
              >
                <option value="feature">Feature</option>
                <option value="integration">Integration</option>
                <option value="api">API</option>
                <option value="enhancement">Enhancement</option>
                <option value="monitoring">Monitoring</option>
              </TextField>
              <TextField
                label="Priority"
                value={formData.priority}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    priority: e.target.value as Priority,
                  })
                }
                select
                SelectProps={{ native: true }}
                fullWidth
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </TextField>
              <TextField
                label="Estimated Hours"
                type="number"
                value={formData.estimatedHours}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    estimatedHours: parseInt(e.target.value) || 0,
                  })
                }
                fullWidth
                inputProps={{ min: 0 }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseCreateDialog}>
              {t(KEYS.common.cancel)}
            </Button>
            <Button onClick={handleCreateTask} variant="contained">
              Create
            </Button>
          </DialogActions>
        </Dialog>

        {/* Edit Task Dialog */}
        <Dialog
          ownerKey={editDialogOpenOwnerKey}
          open={editDialogOpen}
          onClose={handleCloseEditDialog}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>{t(KEYS.tasks.dialog.editTitle)}</DialogTitle>
          <DialogContent>
            <Stack spacing={3} sx={{ mt: 1 }}>
              <TextField
                label="Title"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                fullWidth
                required
              />
              <TextField
                label="Description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                fullWidth
                multiline
                rows={3}
              />
              <TextField
                label="Status"
                value={formData.status}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    status: e.target.value as WorkStatus,
                  })
                }
                select
                SelectProps={{ native: true }}
                fullWidth
              >
                <option value="BACKLOG">Backlog</option>
                <option value="ACTIVE">Active</option>
                <option value="COMPLETED">Completed</option>
                <option value="ON_HOLD">On Hold</option>
                <option value="CANCELLED">Cancelled</option>
              </TextField>
              <TextField
                label="Type"
                value={formData.type}
                onChange={(e) =>
                  setFormData({ ...formData, type: e.target.value })
                }
                select
                SelectProps={{ native: true }}
                fullWidth
              >
                <option value="feature">Feature</option>
                <option value="integration">Integration</option>
                <option value="api">API</option>
                <option value="enhancement">Enhancement</option>
                <option value="monitoring">Monitoring</option>
              </TextField>
              <TextField
                label="Priority"
                value={formData.priority}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    priority: e.target.value as Priority,
                  })
                }
                select
                SelectProps={{ native: true }}
                fullWidth
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </TextField>
              <TextField
                label="Estimated Hours"
                type="number"
                value={formData.estimatedHours}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    estimatedHours: parseInt(e.target.value) || 0,
                  })
                }
                fullWidth
                inputProps={{ min: 0 }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseEditDialog}>
              {t(KEYS.common.cancel)}
            </Button>
            <Button onClick={handleUpdateTask} variant="contained">
              Save Changes
            </Button>
          </DialogActions>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog
          ownerKey={deleteDialogOpenOwnerKey}
          open={deleteDialogOpen}
          onClose={handleCloseDeleteDialog}
        >
          <DialogTitle>{t(KEYS.tasks.dialog.deleteTitle)}</DialogTitle>
          <DialogContent>
            <Typography>
              Are you sure you want to delete the {TERMS.task} "
              {deletingTask?.name || `this ${TERMS.task}`}"? This action cannot
              be undone.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDeleteDialog}>Cancel</Button>
            <Button
              onClick={handleDeleteTask}
              color="error"
              variant="contained"
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </>
  );
};
