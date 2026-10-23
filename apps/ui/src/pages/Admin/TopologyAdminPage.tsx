import React, { useEffect, useMemo, useState } from "react";
import { useQueryState, parseAsInteger, parseAsString } from "nuqs";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RefreshIcon from "@mui/icons-material/Refresh";
import { TopologyApi, Configuration } from "@hey-hey/ui-common/api";
import type {
  TopologyCategorySummaryDto,
  TopologySubfacetDto,
  TopologyEntitySummaryDto,
  TopologyCategorySummarizationRunDto,
  TopologySubfacetConsolidationRunDto,
  TopologySummaryCategory,
} from "@hey-hey/ui-common/api";
import { useProjects } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { getApiBaseUrl } from "@hey-hey/ui-common/services";

type AuditRecord =
  | (TopologyCategorySummarizationRunDto & { type: "Category" })
  | (TopologySubfacetConsolidationRunDto & { type: "Subfacet" });

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => (
  <div
    role="tabpanel"
    hidden={value !== index}
    id={`tabpanel-${index}`}
    aria-labelledby={`tab-${index}`}
  >
    {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
  </div>
);

const formatDate = (isoDate: string): string => {
  return new Date(isoDate).toLocaleString();
};

interface CategorySummariesTabProps {
  categorySummaries: TopologyCategorySummaryDto[];
  loading: boolean;
}

const CategorySummariesTab: React.FC<CategorySummariesTabProps> = ({
  categorySummaries,
  loading,
}) => {
  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (categorySummaries.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 4 }}>
        <Typography variant="body2" color="text.secondary">
          No category summaries found
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      {categorySummaries.map((summary) => (
        <Paper key={summary.category} sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Chip label={summary.category} color="primary" variant="filled" />
              <Typography variant="caption" color="text.secondary">
                {formatDate(summary.lastUpdated)}
              </Typography>
            </Box>
            <Typography variant="body2">{summary.summary}</Typography>
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
};

interface SubfacetsTabProps {
  subfacets: TopologySubfacetDto[];
  loading: boolean;
}

const SubfacetsTab: React.FC<SubfacetsTabProps> = ({ subfacets, loading }) => {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedSubfacet, setSelectedSubfacet] =
    useState<TopologySubfacetDto | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const filteredSubfacets = useMemo(() => {
    if (!statusFilter) return subfacets;
    return subfacets.filter((s) => s.status === statusFilter);
  }, [subfacets, statusFilter]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      <Paper sx={{ mb: 2, p: 2 }}>
        <FormControl sx={{ minWidth: 150 }}>
          <InputLabel>Status</InputLabel>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            label="Status"
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="ACTIVE">Active</MenuItem>
            <MenuItem value="DEPRECATED">Deprecated</MenuItem>
          </Select>
        </FormControl>
      </Paper>

      {filteredSubfacets.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <Typography variant="body2" color="text.secondary">
            No subfacets found
          </Typography>
        </Box>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                <TableCell>Name</TableCell>
                <TableCell>Slug</TableCell>
                <TableCell>Summary</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredSubfacets.map((subfacet) => (
                <TableRow
                  key={subfacet.id}
                  onClick={() => {
                    setSelectedSubfacet(subfacet);
                    setModalOpen(true);
                  }}
                  sx={{
                    cursor: "pointer",
                    "&:hover": { backgroundColor: "action.hover" },
                  }}
                >
                  <TableCell>{subfacet.name}</TableCell>
                  <TableCell
                    sx={{ fontFamily: "monospace", fontSize: "0.9em" }}
                  >
                    {subfacet.slug}
                  </TableCell>
                  <TableCell
                    sx={{
                      maxWidth: 300,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {subfacet.summary || (
                      <Typography variant="body2" color="text.secondary">
                        No summary
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip label={subfacet.category} size="small" />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={subfacet.status}
                      color={
                        subfacet.status === "ACTIVE" ? "success" : "default"
                      }
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{formatDate(subfacet.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{selectedSubfacet?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 2 }}>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                ID
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
              >
                {selectedSubfacet?.id}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Slug
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
              >
                {selectedSubfacet?.slug}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Summary
              </Typography>
              <Typography variant="body2">
                {selectedSubfacet?.summary || (
                  <Typography variant="body2" color="text.secondary">
                    No summary
                  </Typography>
                )}
              </Typography>
            </Box>
            {selectedSubfacet?.lastSummarizedAt && (
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Last Summarized
                </Typography>
                <Typography variant="body2">
                  {formatDate(selectedSubfacet.lastSummarizedAt)}
                </Typography>
              </Box>
            )}
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Category
              </Typography>
              <Typography variant="body2">
                {selectedSubfacet?.category}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Status
              </Typography>
              <Typography variant="body2">
                {selectedSubfacet?.status}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Created
              </Typography>
              <Typography variant="body2">
                {selectedSubfacet && formatDate(selectedSubfacet.createdAt)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Updated
              </Typography>
              <Typography variant="body2">
                {selectedSubfacet && formatDate(selectedSubfacet.updatedAt)}
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

interface EntitySummariesTabProps {
  entities: TopologyEntitySummaryDto[];
  loading: boolean;
}

const EntitySummariesTab: React.FC<EntitySummariesTabProps> = ({
  entities,
  loading,
}) => {
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedEntity, setSelectedEntity] =
    useState<TopologyEntitySummaryDto | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const filteredEntities = useMemo(() => {
    let filtered = entities;

    // Filter by entity type
    if (entityTypeFilter) {
      filtered = filtered.filter((e) => e.entityType === entityTypeFilter);
    }

    // Filter by search query (ID or summary)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.entityId.toLowerCase().includes(query) ||
          e.summary.toLowerCase().includes(query),
      );
    }

    return filtered;
  }, [entities, entityTypeFilter, searchQuery]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      <Paper sx={{ mb: 2, p: 2 }}>
        <Stack
          direction="row"
          spacing={2}
          alignItems="flex-start"
          sx={{ flexWrap: "wrap", gap: 2 }}
        >
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel>Entity Type</InputLabel>
            <Select
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              label="Entity Type"
            >
              <MenuItem value="">All Types</MenuItem>
              <MenuItem value="ARTIFACT">Artifact</MenuItem>
              <MenuItem value="INITIATIVE">Initiative</MenuItem>
              <MenuItem value="PROJECT">Project</MenuItem>
              <MenuItem value="TASK">Task</MenuItem>
              <MenuItem value="MESSAGE">Message</MenuItem>
              <MenuItem value="CONVERSATION">Conversation</MenuItem>
              <MenuItem value="DESIGN_DOC">Design Doc</MenuItem>
              <MenuItem value="AGENT_SESSION">Coding Session</MenuItem>
              <MenuItem value="CODING_PROMPT">Coding Prompt</MenuItem>
            </Select>
          </FormControl>
          <Box sx={{ flex: 1, minWidth: 250 }}>
            <TextField
              placeholder="Search by ID or summary..."
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSearchQuery(e.target.value)
              }
              fullWidth
              size="small"
              variant="outlined"
            />
          </Box>
        </Stack>
      </Paper>

      {filteredEntities.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <Typography variant="body2" color="text.secondary">
            No entities found
          </Typography>
        </Box>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                <TableCell>Type</TableCell>
                <TableCell>Entity ID</TableCell>
                <TableCell>Summary</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Subfacets</TableCell>
                <TableCell>Updated</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredEntities.map((entity) => (
                <TableRow
                  key={`${entity.entityType}-${entity.entityId}`}
                  onClick={() => {
                    setSelectedEntity(entity);
                    setModalOpen(true);
                  }}
                  sx={{
                    cursor: "pointer",
                    "&:hover": { backgroundColor: "action.hover" },
                  }}
                >
                  <TableCell>
                    <Chip label={entity.entityType} size="small" />
                  </TableCell>
                  <TableCell
                    sx={{
                      fontFamily: "monospace",
                      fontSize: "0.9em",
                      maxWidth: 150,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {entity.entityId}
                  </TableCell>
                  <TableCell
                    sx={{
                      maxWidth: 300,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entity.summary}
                  </TableCell>
                  <TableCell>
                    <Chip label={entity.category} size="small" />
                  </TableCell>
                  <TableCell>{entity.subfacets?.length ?? 0}</TableCell>
                  <TableCell>{formatDate(entity.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {selectedEntity?.entityType}: {selectedEntity?.entityId}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ pt: 2 }}>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Summary
              </Typography>
              <Typography variant="body2">{selectedEntity?.summary}</Typography>
            </Box>

            <Box>
              <Typography
                variant="subtitle2"
                color="text.secondary"
                gutterBottom
              >
                Subfacets ({selectedEntity?.subfacets?.length ?? 0})
              </Typography>
              {selectedEntity?.subfacets &&
              selectedEntity.subfacets.length > 0 ? (
                <Stack spacing={1}>
                  {selectedEntity.subfacets.map((subfacet) => (
                    <Paper key={subfacet.id} sx={{ p: 1 }}>
                      <Typography variant="body2" fontWeight="medium">
                        {subfacet.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Updated: {formatDate(subfacet.updatedAt)}
                      </Typography>
                    </Paper>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No subfacets
                </Typography>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

interface AuditRecordsTabProps {
  auditRecords: AuditRecord[];
  loading: boolean;
}

const AuditRecordsTab: React.FC<AuditRecordsTabProps> = ({
  auditRecords,
  loading,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (auditRecords.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 4 }}>
        <Typography variant="body2" color="text.secondary">
          No audit records found
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      {auditRecords.map((audit) => (
        <Paper key={audit.id} sx={{ p: 2 }}>
          <Stack spacing={1}>
            {/* Summary Row */}
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{ flexWrap: "wrap" }}
              >
                <Chip label={audit.category} size="small" color="primary" />
                <Chip label={audit.type} size="small" variant="outlined" />
                <Typography variant="body2" color="text.secondary">
                  Threshold: {audit.thresholdApplied}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatDate(audit.createdAt)}
                </Typography>
              </Stack>
              <Button
                size="small"
                onClick={() =>
                  setExpandedId(expandedId === audit.id ? null : audit.id)
                }
                endIcon={
                  expandedId === audit.id ? (
                    <ExpandLessIcon />
                  ) : (
                    <ExpandMoreIcon />
                  )
                }
              >
                {expandedId === audit.id ? "Hide" : "Show"} Details
              </Button>
            </Box>

            {/* Time Range */}
            <Typography variant="caption" color="text.secondary">
              Time Range: {formatDate(audit.since)} → {formatDate(audit.until)}
            </Typography>

            {/* Expanded JSON Details */}
            <Collapse in={expandedId === audit.id}>
              <Stack spacing={2} sx={{ mt: 2 }}>
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Accumulated Snapshot
                  </Typography>
                  <Paper sx={{ p: 1, bgcolor: "grey.100" }}>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: "0.75rem",
                        overflow: "auto",
                        maxHeight: "300px",
                      }}
                    >
                      {JSON.stringify(audit.accumulatedSnapshot, null, 2)}
                    </pre>
                  </Paper>
                </Box>

                {audit.consolidatedBefore && (
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>
                      Consolidated Before
                    </Typography>
                    <Paper sx={{ p: 1, bgcolor: "grey.100" }}>
                      <pre
                        style={{
                          margin: 0,
                          fontSize: "0.75rem",
                          overflow: "auto",
                          maxHeight: "300px",
                        }}
                      >
                        {JSON.stringify(audit.consolidatedBefore, null, 2)}
                      </pre>
                    </Paper>
                  </Box>
                )}

                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Consolidation Result
                  </Typography>
                  <Paper sx={{ p: 1, bgcolor: "grey.100" }}>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: "0.75rem",
                        overflow: "auto",
                        maxHeight: "300px",
                      }}
                    >
                      {JSON.stringify(audit.consolidationResult, null, 2)}
                    </pre>
                  </Paper>
                </Box>
              </Stack>
            </Collapse>
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
};

export const TopologyAdminPage: React.FC = () => {
  const { currentOrgId } = useUserIdentity() || {};
  const { projects } = useProjects(currentOrgId, {
    enabled: !!currentOrgId,
  });
  const [currentTab, setCurrentTab] = useQueryState(
    "tab",
    parseAsInteger.withDefault(0),
  );
  const [selectedProjectId, setSelectedProjectId] = useQueryState(
    "project",
    parseAsString.withDefault(""),
  );
  const [categoryFilter, setCategoryFilter] = useState<
    TopologySummaryCategory | ""
  >("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab data states
  const [categorySummaries, setCategorySummaries] = useState<
    TopologyCategorySummaryDto[]
  >([]);
  const [subfacets, setSubfacets] = useState<TopologySubfacetDto[]>([]);
  const [entities, setEntities] = useState<TopologyEntitySummaryDto[]>([]);
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);

  const apiClient = new TopologyApi(
    new Configuration({
      basePath: getApiBaseUrl(),
    }),
  );

  const fetchCategorySummaries = async (): Promise<void> => {
    if (!currentOrgId || !selectedProjectId) {
      setCategorySummaries([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.listTopologyCategorySummaries({
        organizationId: currentOrgId,
        projectId: selectedProjectId,
        category: categoryFilter || undefined,
      });
      // API returns array directly in response.data
      const data = Array.isArray(response.data.data)
        ? (response.data.data as TopologyCategorySummaryDto[])
        : [];
      setCategorySummaries(data);
    } catch (err) {
      setError("Failed to fetch category summaries");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubfacets = async (): Promise<void> => {
    if (!currentOrgId || !selectedProjectId) {
      setSubfacets([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.listTopologySubfacets({
        organizationId: currentOrgId,
        projectId: selectedProjectId,
        category: categoryFilter || undefined,
      });
      // API returns array directly in response.data
      const data = Array.isArray(response.data.data)
        ? (response.data.data as TopologySubfacetDto[])
        : [];
      setSubfacets(data);
    } catch (err) {
      setError("Failed to fetch subfacets");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchEntitySummaries = async (): Promise<void> => {
    if (!currentOrgId || !selectedProjectId) {
      setEntities([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.listTopologyEntitySummaries({
        organizationId: currentOrgId,
        projectId: selectedProjectId,
        category: categoryFilter || undefined,
      });
      // API returns array directly in response.data
      const data = Array.isArray(response.data.data)
        ? (response.data.data as TopologyEntitySummaryDto[])
        : [];
      setEntities(data);
    } catch (err) {
      setError("Failed to fetch entity summaries");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditRecords = async (): Promise<void> => {
    if (!currentOrgId || !selectedProjectId) {
      setAuditRecords([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const [categoryResponse, subfacetResponse] = await Promise.all([
        apiClient.listTopologyCategoryAudits({
          organizationId: currentOrgId,
          projectId: selectedProjectId,
          category: categoryFilter || undefined,
          limit: 50,
        }),
        apiClient.listTopologySubfacetAudits({
          organizationId: currentOrgId,
          projectId: selectedProjectId,
          category: categoryFilter || undefined,
          limit: 50,
        }),
      ]);

      // API returns array directly in response.data
      const categoryData = Array.isArray(categoryResponse.data?.data)
        ? (categoryResponse.data.data as TopologyCategorySummarizationRunDto[])
        : [];
      const subfacetData = Array.isArray(subfacetResponse.data?.data)
        ? (subfacetResponse.data.data as TopologySubfacetConsolidationRunDto[])
        : [];

      const combined: AuditRecord[] = [
        ...categoryData.map((r) => ({
          ...r,
          type: "Category" as const,
        })),
        ...subfacetData.map((r) => ({
          ...r,
          type: "Subfacet" as const,
        })),
      ].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      setAuditRecords(combined);
    } catch (err) {
      setError("Failed to fetch audit records");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch data when tab changes or category filter changes
  useEffect(() => {
    switch (currentTab) {
      case 0:
        void fetchCategorySummaries();
        break;
      case 1:
        void fetchSubfacets();
        break;
      case 2:
        void fetchEntitySummaries();
        break;
      case 3:
        void fetchAuditRecords();
        break;
      default:
        break;
    }
  }, [currentTab, categoryFilter, currentOrgId, selectedProjectId]);

  const handleRefresh = (): void => {
    switch (currentTab) {
      case 0:
        void fetchCategorySummaries();
        break;
      case 1:
        void fetchSubfacets();
        break;
      case 2:
        void fetchEntitySummaries();
        break;
      case 3:
        void fetchAuditRecords();
        break;
      default:
        break;
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Topology Admin
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Shared Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <FormControl sx={{ minWidth: 240 }}>
            <InputLabel>Project</InputLabel>
            <Select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              label="Project"
              disabled={!currentOrgId}
            >
              <MenuItem value="">
                <em>Select a project</em>
              </MenuItem>
              {projects?.map((project) => (
                <MenuItem key={project.id} value={project.id}>
                  {project.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel>Category</InputLabel>
            <Select
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(
                  e.target.value as TopologySummaryCategory | "",
                )
              }
              label="Category"
            >
              <MenuItem value="">All Categories</MenuItem>
              <MenuItem value="technology">Technology</MenuItem>
              <MenuItem value="product">Product</MenuItem>
              <MenuItem value="process">Process</MenuItem>
              <MenuItem value="people">People</MenuItem>
            </Select>
          </FormControl>
          <Button
            startIcon={<RefreshIcon />}
            onClick={handleRefresh}
            variant="outlined"
            disabled={!currentOrgId || !selectedProjectId}
          >
            Refresh
          </Button>
        </Stack>
      </Paper>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
        <Tabs
          value={currentTab}
          onChange={(_, newValue) => setCurrentTab(newValue)}
          aria-label="topology admin tabs"
        >
          <Tab
            label="Category Summaries"
            id="tab-0"
            aria-controls="tabpanel-0"
          />
          <Tab label="Subfacets" id="tab-1" aria-controls="tabpanel-1" />
          <Tab label="Entity Summaries" id="tab-2" aria-controls="tabpanel-2" />
          <Tab label="Audit Records" id="tab-3" aria-controls="tabpanel-3" />
        </Tabs>
      </Box>

      {/* Tab Panels */}
      <TabPanel value={currentTab} index={0}>
        <CategorySummariesTab
          categorySummaries={categorySummaries}
          loading={loading}
        />
      </TabPanel>

      <TabPanel value={currentTab} index={1}>
        <SubfacetsTab subfacets={subfacets} loading={loading} />
      </TabPanel>

      <TabPanel value={currentTab} index={2}>
        <EntitySummariesTab entities={entities} loading={loading} />
      </TabPanel>

      <TabPanel value={currentTab} index={3}>
        <AuditRecordsTab auditRecords={auditRecords} loading={loading} />
      </TabPanel>
    </Box>
  );
};
