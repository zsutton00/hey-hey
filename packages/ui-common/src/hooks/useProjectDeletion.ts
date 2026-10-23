import { useState } from "react";
import type { ProjectResponseDto } from "../api";

export const useProjectDeletion = () => {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState<boolean>(false);
  const [projectToDelete, setProjectToDelete] =
    useState<ProjectResponseDto | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(
    null
  );

  const openDeleteDialog = (project: ProjectResponseDto) => {
    setProjectToDelete(project);
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setProjectToDelete(null);
  };

  const setDeleting = (projectId: string | null) => {
    setDeletingProjectId(projectId);
  };

  return {
    deleteDialogOpen,
    projectToDelete,
    deletingProjectId,
    openDeleteDialog,
    closeDeleteDialog,
    setDeleting,
  };
};
