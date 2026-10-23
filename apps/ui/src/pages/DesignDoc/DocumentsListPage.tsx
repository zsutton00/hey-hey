import {
  Alert,
  Box,
  Paper,
  Stack,
  TextField,
  Typography,
  IconButton,
  Button,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import React, { useCallback, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Library,
} from "@hey-hey/ui-common/components";
import { useModalService } from "@hey-hey/ui-common/context";
import {
  useProjectLibrary,
  useProject,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { compose } from "@hey-hey/ui-common/i18n";
import { PageBreadcrumbs } from "../../components/Layout";
import type { DesignDocLibraryNodeDto } from "@hey-hey/ui-common/api";
import { WebPathService } from "@hey-hey/ui-common/services";

export const DocumentsListPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { currentOrgId } = useUserIdentity() || {};
  const navigate = useNavigate();
  const { t } = useTranslation();
  const modalService = useModalService();

  const [searchTerm, setSearchTerm] = useState("");

  const {
    library,
    isLoading,
    error,
    refetch,
  } = useProjectLibrary(currentOrgId, projectId || "", {
    enabled: !!currentOrgId && !!projectId,
  });

  const { data: project } = useProject(currentOrgId || "", projectId || "", {
    enabled: !!currentOrgId && !!projectId,
    preferStale: true,
  });

  const filteredLibrary = React.useMemo(() => {
    if (!searchTerm.trim()) {
      return library;
    }

    const searchLower = searchTerm.toLowerCase();
    const filterNodes = (
      nodes: DesignDocLibraryNodeDto[],
    ): DesignDocLibraryNodeDto[] => {
      return nodes
        .map((node) => {
          const filteredChildren = filterNodes(node.children ?? []);
          const matches = node.name.toLowerCase().includes(searchLower);
          if (!matches && filteredChildren.length === 0) {
            return null;
          }
          return {
            ...node,
            children: filteredChildren,
          };
        })
        .filter((node): node is DesignDocLibraryNodeDto => node !== null);
    };

    return filterNodes(library);
  }, [library, searchTerm]);

  const handleRefresh = () => {
    refetch();
  };

  const handleSearch = () => {
    // Search updates live as users type, but keep this for icon/Enter handling.
  };

  const handleLibraryClick = (node: DesignDocLibraryNodeDto) => {
    if (!projectId) {
      return;
    }

    switch (node.type) {
      case "design-doc":
        navigate(
          WebPathService.designDoc({ projectId, designDocId: node.id }),
        );
        return;
      case "initiative":
        navigate(
          WebPathService.initiativeDetail({
            projectId,
            initiativeId: node.id,
          }),
        );
        return;
      case "plan":
        navigate(WebPathService.plan({ projectId, planId: node.id }));
        return;
      case "task":
        navigate(WebPathService.task({ projectId, taskId: node.id }));
        return;
      default:
        return;
    }
  };

  const handleOpenCreateDocument = useCallback(() => {
    if (!modalService || !projectId) {
      return;
    }

    modalService.showCreateDocument({
      mode: "blank_doc",
      projectId,
      onSuccess: (newDoc) => {
        const path = WebPathService.designDoc({
          projectId,
          designDocId: newDoc.id,
        });
        navigate(path);
      },
    });
  }, [modalService, navigate, projectId]);

  return (
    <Box>
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
            label: t("documents.title", "Documents"),
            isCurrent: true,
            type: "design-doc",
          },
        ]}
      />

      <Box sx={{ p: 3, pt: 0 }}>
        {/* Page Header */}
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ mb: 3 }}
        >
          <Typography variant="h4">
            {t("documents.title", "Documents")}
          </Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <IconButton onClick={handleRefresh} title="Refresh">
              <RefreshIcon />
            </IconButton>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleOpenCreateDocument}
              disabled={!modalService}
            >
              {t("documents.createDocument", "Create Document")}
            </Button>
          </Box>
        </Stack>

        {/* Filters and Search */}
        <Paper sx={{ p: 3, mb: 3 }}>
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", md: "row" },
              gap: 2,
              alignItems: "center",
            }}
          >
            <Box
              sx={{
                flex: { md: "1 1 60%" },
                width: { xs: "100%", md: "auto" },
              }}
            >
              <TextField
                label={t("documents.search", "Search documents")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                fullWidth
                InputProps={{
                  endAdornment: (
                    <IconButton onClick={handleSearch}>
                      <SearchIcon />
                    </IconButton>
                  ),
                }}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    handleSearch();
                  }
                }}
              />
            </Box>
          </Box>
        </Paper>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {t("documents.loadError", "Failed to load documents: {{error}}", {
              error: (error as Error).message,
            })}
          </Alert>
        )}

        {/* Documents Library */}
        {isLoading ? (
          <Box sx={{ textAlign: "center", py: 6 }}>
            <Typography>
              {t("documents.loading", "Loading documents...")}
            </Typography>
          </Box>
        ) : (
          <>
            <Paper sx={{ mt: 2 }}>
              <Library
                library={filteredLibrary}
                onEntityClick={handleLibraryClick}
              />
            </Paper>

            {filteredLibrary.length === 0 && !isLoading && (
              <Paper sx={{ mt: 2 }}>
                <Box sx={{ textAlign: "center", py: 6 }}>
                  <Typography variant="h6" color="text.secondary">
                    {t("documents.noDocuments", "No documents found")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {searchTerm
                      ? t(
                          "documents.adjustSearch",
                          "Try adjusting your search terms",
                        )
                      : t(
                          "documents.createFirst",
                          "Create your first document to get started",
                        )}
                  </Typography>
                </Box>
              </Paper>
            )}
          </>
        )}
      </Box>
    </Box>
  );
};
