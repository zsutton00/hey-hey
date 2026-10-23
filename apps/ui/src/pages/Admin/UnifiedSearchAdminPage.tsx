import React, { useState, useCallback } from "react";
import {
  Box,
  Paper,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Alert,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Checkbox,
  FormControlLabel,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import VisibilityIcon from "@mui/icons-material/Visibility";
import {
  InitiativeSelector,
  TaskSelector,
  DesignDocSelector,
} from "@hey-hey/ui-common/components";
import { useUnifiedSearch, useProjects } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { useModalService } from "@hey-hey/ui-common/context";
import type {
  UnifiedSearchRequest,
  UnifiedSearchResponse,
  UnifiedSearchResult,
  UnifiedGraphSearchResult,
  UnifiedEmbeddingsSearchResult,
} from "@hey-hey/ui-common/api";
import { useQueryState, parseAsString } from "nuqs";

export const UnifiedSearchAdminPage: React.FC = () => {
  const { currentOrgId } = useUserIdentity() || {};
  const modalService = useModalService();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  // Load projects for the organization
  const { projects } = useProjects(currentOrgId, {
    enabled: !!currentOrgId,
  });

  // URL-persisted state
  const [searchQuery, setSearchQuery] = useQueryState("q", parseAsString);
  const [selectedTaskId, setSelectedTaskId] = useQueryState(
    "task",
    parseAsString
  );
  const [selectedInitiativeId, setSelectedInitiativeId] = useQueryState(
    "initiative",
    parseAsString
  );
  const [selectedDesignDocId, setSelectedDesignDocId] = useQueryState(
    "designDoc",
    parseAsString
  );

  // Local state
  const [results, setResults] = useState<UnifiedSearchResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<unknown>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [resultType, setResultType] = useState<
    "combined" | "graph" | "embeddings" | null
  >(null);

  // Advanced config state
  const [maxResults, setMaxResults] = useState<number>(10);
  const [similarityThreshold, setSimilarityThreshold] = useState<number>(0.7);
  const [includeRelationships, setIncludeRelationships] =
    useState<boolean>(true);
  const [graphPage, setGraphPage] = useState<number>(1);
  const [graphPageSize, setGraphPageSize] = useState<number>(20);

  const { unifiedSearch } = useUnifiedSearch(
    currentOrgId || "",
    selectedProjectId || ""
  );

  const handleSearch = useCallback(async (): Promise<void> => {
    if (!currentOrgId || !selectedProjectId) {
      setError("Organization ID and Project ID are required");
      return;
    }

    if (!searchQuery || searchQuery.trim().length === 0) {
      setError("Search query is required");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const seedEntityIds = [
        selectedTaskId,
        selectedInitiativeId,
        selectedDesignDocId,
      ].filter(Boolean) as string[];

      const request: UnifiedSearchRequest = {
        intent: "hybrid",
        query: searchQuery,
        embeddings: {
          maxResults,
          similarityThreshold,
        },
        graph: {
          seedEntityIds: seedEntityIds.length > 0 ? seedEntityIds : undefined,
          includeRelationships,
          page: graphPage,
          size: graphPageSize,
        },
      };

      const response = await unifiedSearch(request);
      setResults(response);
    } catch (err) {
      const error = err as {
        message?: string;
        response?: { data?: { message?: string } };
      };
      setError(
        error.response?.data?.message ||
          error.message ||
          "Failed to perform search"
      );
    } finally {
      setLoading(false);
    }
  }, [
    currentOrgId,
    selectedProjectId,
    searchQuery,
    selectedTaskId,
    selectedInitiativeId,
    selectedDesignDocId,
    maxResults,
    similarityThreshold,
    includeRelationships,
    graphPage,
    graphPageSize,
    unifiedSearch,
  ]);

  const handleSearchKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  const handleViewDetails = (
    result: unknown,
    type: "combined" | "graph" | "embeddings"
  ): void => {
    setSelectedResult(result);
    setResultType(type);
    setModalOpen(true);
  };

  const handleViewEntity = useCallback(
    (entityType?: UnifiedSearchResult["entityType"], entityId?: string): void => {
      if (!modalService || !currentOrgId || !entityType || !entityId) {
        return;
      }

      modalService.showEntityDetails({
        source: "lookup",
        entityType,
        entityId,
        organizationId: currentOrgId,
        projectId: selectedProjectId || undefined,
      });
    },
    [modalService, currentOrgId, selectedProjectId]
  );

  const handleCloseModal = (): void => {
    setModalOpen(false);
    setSelectedResult(null);
    setResultType(null);
  };

  const handleClearSeeds = (): void => {
    setSelectedTaskId(null);
    setSelectedInitiativeId(null);
    setSelectedDesignDocId(null);
  };

  const handleInitiativeChange = (initiativeId: string | null): void => {
    setSelectedInitiativeId(initiativeId);
    // Clear task when initiative changes
    if (!initiativeId) {
      setSelectedTaskId(null);
    }
  };

  if (!currentOrgId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">
          Please select an organization to use unified search.
        </Alert>
      </Box>
    );
  }

  const combinedResultsCount = results?.results?.length ?? 0;
  const graphResultsCount = results?.graph?.results?.length ?? 0;
  const embeddingsResultsCount = results?.embeddings?.data?.length ?? 0;

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Unified Search Admin Dashboard
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack spacing={2}>
          {/* Project Selector Row */}
          <Stack direction="row" spacing={2} alignItems="center">
            <FormControl size="small" sx={{ minWidth: 250 }}>
              <InputLabel>Project</InputLabel>
              <Select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                label="Project"
              >
                <MenuItem value="">
                  <em>Select a project</em>
                </MenuItem>
                {projects?.map((project: { id: string; name: string }) => (
                  <MenuItem key={project.id} value={project.id}>
                    {project.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          {/* Entity Selectors Row */}
          {selectedProjectId && (
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
              <InitiativeSelector
                organizationId={currentOrgId}
                projectId={selectedProjectId}
                value={selectedInitiativeId}
                onChange={handleInitiativeChange}
                placeholder="Seed with initiative"
                size="small"
                sx={{ minWidth: 200 }}
              />

              <TaskSelector
                organizationId={currentOrgId}
                projectId={selectedProjectId}
                value={selectedTaskId}
                onChange={(taskId) => setSelectedTaskId(taskId)}
                placeholder="Seed with task"
                size="small"
                sx={{ minWidth: 200 }}
              />

              <DesignDocSelector
                organizationId={currentOrgId}
                projectId={selectedProjectId}
                value={selectedDesignDocId}
                onChange={(designDocId) => setSelectedDesignDocId(designDocId)}
                placeholder="Seed with design doc"
                size="small"
                sx={{ minWidth: 200 }}
              />

              <Button
                variant="outlined"
                onClick={handleClearSeeds}
                size="small"
                disabled={
                  !selectedTaskId &&
                  !selectedInitiativeId &&
                  !selectedDesignDocId
                }
              >
                Clear Seeds
              </Button>
            </Stack>
          )}

          {/* Search Query Row */}
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <TextField
              label="Search Query"
              placeholder="Enter search query..."
              value={searchQuery ?? ""}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              multiline
              rows={3}
              fullWidth
              helperText="Press Enter or click Search to execute query"
            />
            <Button
              variant="contained"
              startIcon={<SearchIcon />}
              onClick={handleSearch}
              disabled={loading || !searchQuery || !selectedProjectId}
              sx={{ height: 56, minWidth: 120 }}
            >
              {loading ? "Searching..." : "Search"}
            </Button>
          </Stack>

          {/* Advanced Options */}
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle2">Advanced Options</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <Typography variant="subtitle2" color="text.secondary">
                  Embeddings Options
                </Typography>
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Max Results"
                    type="number"
                    value={maxResults}
                    onChange={(e) =>
                      setMaxResults(parseInt(e.target.value, 10))
                    }
                    slotProps={{
                      htmlInput: { min: 1, max: 100 },
                    }}
                    size="small"
                    sx={{ width: 150 }}
                  />
                  <TextField
                    label="Similarity Threshold"
                    type="number"
                    value={similarityThreshold}
                    onChange={(e) =>
                      setSimilarityThreshold(parseFloat(e.target.value))
                    }
                    slotProps={{
                      htmlInput: { min: 0, max: 1, step: 0.1 },
                    }}
                    size="small"
                    sx={{ width: 150 }}
                  />
                </Stack>

                <Typography variant="subtitle2" color="text.secondary">
                  Graph Options
                </Typography>
                <Stack direction="row" spacing={2} alignItems="center">
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={includeRelationships}
                        onChange={(e) =>
                          setIncludeRelationships(e.target.checked)
                        }
                      />
                    }
                    label="Include Relationships"
                  />
                  <TextField
                    label="Page"
                    type="number"
                    value={graphPage}
                    onChange={(e) => setGraphPage(parseInt(e.target.value, 10))}
                    slotProps={{
                      htmlInput: { min: 1 },
                    }}
                    size="small"
                    sx={{ width: 100 }}
                  />
                  <TextField
                    label="Page Size"
                    type="number"
                    value={graphPageSize}
                    onChange={(e) =>
                      setGraphPageSize(parseInt(e.target.value, 10))
                    }
                    slotProps={{
                      htmlInput: { min: 1, max: 100 },
                    }}
                    size="small"
                    sx={{ width: 120 }}
                  />
                </Stack>
              </Stack>
            </AccordionDetails>
          </Accordion>

          {/* Intent Display */}
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              Search Intent:
            </Typography>
            <Chip label="Hybrid" size="small" color="primary" />
          </Stack>
        </Stack>
      </Paper>

      {/* Results Summary */}
      {results && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Showing {combinedResultsCount} results, {graphResultsCount} graph
            results, {embeddingsResultsCount} embeddings results
            {results.execution?.totalMs && (
              <> • Execution time: {results.execution.totalMs}ms</>
            )}
          </Typography>
        </Box>
      )}

      {/* Combined Results Section */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">
            Results ({combinedResultsCount})
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Score</TableCell>
                  <TableCell>Entity Type</TableCell>
                  <TableCell>Entity ID</TableCell>
                  <TableCell>Sources</TableCell>
                  <TableCell>Graph</TableCell>
                  <TableCell>Semantic</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results?.results?.map(
                  (result: UnifiedSearchResult, index: number) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Chip
                          label={result.score?.toFixed(3) ?? "N/A"}
                          size="small"
                          color="primary"
                        />
                      </TableCell>
                      <TableCell>{result.entityType ?? "N/A"}</TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}
                        >
                          {result.entityId?.substring(0, 24) ?? "N/A"}...
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {result.sources?.length
                          ? result.sources.join(", ")
                          : "N/A"}
                      </TableCell>
                      <TableCell>
                        {result.graphScore?.toFixed(3) ?? "N/A"}
                      </TableCell>
                      <TableCell>
                        {result.semanticScore?.toFixed(3) ?? "N/A"}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            startIcon={<VisibilityIcon />}
                            onClick={() => handleViewDetails(result, "combined")}
                          >
                            View
                          </Button>
                          <Button
                            size="small"
                            onClick={() =>
                              handleViewEntity(result.entityType, result.entityId)
                            }
                            disabled={
                              !modalService ||
                              !currentOrgId ||
                              !result.entityType ||
                              !result.entityId
                            }
                          >
                            View Entity
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </TableContainer>
          {combinedResultsCount === 0 && !loading && (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography variant="body2" color="text.secondary">
                No results found
              </Typography>
            </Box>
          )}
        </AccordionDetails>
      </Accordion>

      {/* Graph Results Section */}
      <Accordion defaultExpanded sx={{ mt: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">
            Graph Results ({graphResultsCount})
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Properties</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results?.graph?.results?.map((result: UnifiedGraphSearchResult, index: number) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}
                      >
                        {result.node ? JSON.stringify(result.node).substring(0, 24) : "N/A"}...
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={result.score?.toFixed(3) ?? "N/A"} size="small" />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 400 }}>
                        {result.node ? JSON.stringify(result.node).substring(0, 100) : "No data"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        startIcon={<VisibilityIcon />}
                        onClick={() => handleViewDetails(result, "graph")}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {graphResultsCount === 0 && !loading && (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography variant="body2" color="text.secondary">
                No graph results found
              </Typography>
            </Box>
          )}
        </AccordionDetails>
      </Accordion>

      {/* Embeddings Results Section */}
      <Accordion defaultExpanded sx={{ mt: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">
            Embeddings Results ({embeddingsResultsCount})
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Score</TableCell>
                  <TableCell>ID</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Preview</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results?.embeddings?.data?.map((result: UnifiedEmbeddingsSearchResult, index: number) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Chip
                        label={result.similarity?.toFixed(3) ?? "N/A"}
                        size="small"
                        color="primary"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}
                      >
                        {result.id?.substring(0, 24) ?? "N/A"}...
                      </Typography>
                    </TableCell>
                    <TableCell>{result.metadata?.type ?? "N/A"}</TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: "monospace",
                          fontSize: "0.75rem",
                          maxWidth: 300,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {result.metadata?.title?.substring(0, 100) ??
                          "No preview"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        startIcon={<VisibilityIcon />}
                        onClick={() => handleViewDetails(result, "embeddings")}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {embeddingsResultsCount === 0 && !loading && (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography variant="body2" color="text.secondary">
                No embeddings results found
              </Typography>
            </Box>
          )}
        </AccordionDetails>
      </Accordion>

      {loading && (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <Typography variant="body2" color="text.secondary">
            Loading...
          </Typography>
        </Box>
      )}

      {/* Result Detail Modal */}
      <Dialog
        open={modalOpen}
        onClose={handleCloseModal}
        maxWidth="md"
        fullWidth
      >
      <DialogTitle>
          Result Details -{" "}
          {resultType === "graph"
            ? "Graph"
            : resultType === "embeddings"
            ? "Embeddings"
            : "Combined"}
        </DialogTitle>
        <DialogContent>
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              mt: 1,
              maxHeight: 600,
              overflow: "auto",
              backgroundColor: "grey.50",
            }}
          >
            <Typography
              variant="body2"
              component="pre"
              sx={{
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "0.85rem",
              }}
            >
              {selectedResult ? JSON.stringify(selectedResult, null, 2) : "No data"}
            </Typography>
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              navigator.clipboard.writeText(
                JSON.stringify(selectedResult, null, 2)
              );
            }}
          >
            Copy to Clipboard
          </Button>
          <Button onClick={handleCloseModal}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
