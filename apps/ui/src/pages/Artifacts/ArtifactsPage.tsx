import { apiClient } from "@hey-hey/ui-common/clients";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type {
  ArtifactResponseDto,
  ArtifactStatus,
  ArtifactType,
} from "@hey-hey/ui-common/api";
import { Artifact } from "../../components/Artifact";

export const ArtifactsPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { currentOrgId } = useUserIdentity() || {};
  const [artifacts, setArtifacts] = useState<ArtifactResponseDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filter states
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<ArtifactType | "">("");
  const [statusFilter, setStatusFilter] = useState<ArtifactStatus | "">("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const limit = 20;

  const loadArtifacts = useCallback(async () => {
    if (!projectId || !currentOrgId) {
      setError("Project ID and Organization context are required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.findManyArtifacts({
        organizationId: currentOrgId,
        projectId,
        type: typeFilter || undefined,
        status: statusFilter || undefined,
        category: categoryFilter || undefined,
        page,
        limit,
        orderBy: "createdAt",
        orderDirection: "desc",
      });
      const { data, totalPages, total } = response.data;

      setArtifacts(data);
      setTotalCount(total);
      setTotalPages(totalPages);
    } catch (err: any) {
      console.error("Failed to load artifacts:", err);
      setError(err?.response?.data?.message || "Failed to load artifacts");
    } finally {
      setLoading(false);
    }
  }, [projectId, currentOrgId, page, typeFilter, statusFilter, categoryFilter]);

  // Search is handled separately to avoid too many API calls
  const handleSearch = useCallback(async () => {
    if (!projectId || !currentOrgId) {
      setError("Project ID and Organization context are required");
      return;
    }

    if (!searchTerm.trim()) {
      loadArtifacts();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.simpleSearchArtifacts({
        organizationId: currentOrgId,
        q: searchTerm,
        projectId,
      });

      const results = response.data.data?.results || [];
      // Handle results structure - they might be direct artifacts or wrapped
      const artifacts = results.map((result: any) => result.artifact || result);
      setArtifacts(artifacts);
      setTotalCount(artifacts.length);
      setTotalPages(1); // Search results are not paginated the same way
    } catch (err: any) {
      console.error("Failed to search artifacts:", err);
      setError(err?.response?.data?.message || "Failed to search artifacts");
    } finally {
      setLoading(false);
    }
  }, [projectId, currentOrgId, searchTerm, loadArtifacts]);

  useEffect(() => {
    if (!searchTerm.trim()) {
      loadArtifacts();
    }
  }, [loadArtifacts, searchTerm]);

  const handlePageChange = (_: React.ChangeEvent<unknown>, newPage: number) => {
    setPage(newPage);
  };

  const handleRefresh = () => {
    if (searchTerm.trim()) {
      handleSearch();
    } else {
      loadArtifacts();
    }
  };

  return (
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
            <Typography variant="h3" gutterBottom>
              Artifacts
            </Typography>
            <Typography variant="h6">
              Browse and search through stored artifacts ({totalCount} total)
            </Typography>
          </div>
          <IconButton onClick={handleRefresh} title="Refresh">
            <RefreshIcon />
          </IconButton>
        </Box>
      </Paper>

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
            sx={{ flex: { md: "1 1 33%" }, width: { xs: "100%", md: "auto" } }}
          >
            <TextField
              label="Search artifacts"
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

          <Box
            sx={{
              flex: { md: "0 0 150px" },
              width: { xs: "100%", md: "auto" },
            }}
          >
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as ArtifactType | "")
                }
                label="Type"
              >
                <MenuItem value="">All Types</MenuItem>
                <MenuItem value="QA_PAIR">Q&A Pair</MenuItem>
                <MenuItem value="DOCUMENT">Document</MenuItem>
                <MenuItem value="CODE_SNIPPET">Code Snippet</MenuItem>
                <MenuItem value="CONVERSATION_SUMMARY">
                  Conversation Summary
                </MenuItem>
                <MenuItem value="PROJECT_INSIGHT">Project Insight</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Box
            sx={{
              flex: { md: "0 0 150px" },
              width: { xs: "100%", md: "auto" },
            }}
          >
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as ArtifactStatus | "")
                }
                label="Status"
              >
                <MenuItem value="">All Statuses</MenuItem>
                <MenuItem value="ACTIVE">Active</MenuItem>
                <MenuItem value="ARCHIVED">Archived</MenuItem>
                <MenuItem value="DRAFT">Draft</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Box
            sx={{ flex: { md: "1 1 33%" }, width: { xs: "100%", md: "auto" } }}
          >
            <TextField
              label="Category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              fullWidth
              placeholder="Filter by category"
            />
          </Box>
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ textAlign: "center", py: 6 }}>
          <Typography>Loading artifacts...</Typography>
        </Box>
      ) : (
        <>
          <Stack spacing={2}>
            {artifacts.map((artifact) => (
              <Artifact artifact={artifact} />
            ))}
          </Stack>

          {artifacts.length === 0 && !loading && (
            <Box sx={{ textAlign: "center", py: 6 }}>
              <Typography variant="h6" color="text.secondary">
                No artifacts found
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {searchTerm
                  ? "Try adjusting your search terms"
                  : "No artifacts have been created yet"}
              </Typography>
            </Box>
          )}

          {/* Pagination */}
          {totalPages > 1 && !searchTerm && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={handlePageChange}
                color="primary"
                showFirstButton
                showLastButton
              />
            </Box>
          )}
        </>
      )}
    </Box>
  );
};
