/**
 * Workflow Templates List Component
 *
 * Displays a list of workflow templates with filtering and status display
 */

import React, { useState, useMemo, useCallback } from "react";
import {
  useQueryState,
  parseAsString,
  parseAsStringEnum,
  parseAsArrayOf,
} from "nuqs";
import {
  Box,
  Paper,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Skeleton,
  Alert,
  IconButton,
  Tooltip,
  Menu,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Divider,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import FilterIcon from "@mui/icons-material/FilterList";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayIcon from "@mui/icons-material/PlayArrow";
import ViewIcon from "@mui/icons-material/Visibility";
import MetricsIcon from "@mui/icons-material/Assessment";
import CategoryIcon from "@mui/icons-material/Category";
import ScheduleIcon from "@mui/icons-material/Schedule";
import ActiveIcon from "@mui/icons-material/CheckCircle";
import InactiveIcon from "@mui/icons-material/PauseCircle";
import DraftIcon from "@mui/icons-material/Build";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { useWorkflowTemplates } from "../../hooks/useWorkflowData";
import type {
  WorkflowTemplateStatus,
  WorkflowTemplateQuery,
  WorkflowTemplateId,
} from "../../types/workflow";

interface WorkflowTemplatesListProps {
  onTemplateSelect: (templateId: WorkflowTemplateId) => void;
  onTemplateExecute?: (templateId: WorkflowTemplateId) => void;
  onTemplateView?: (templateId: WorkflowTemplateId) => void;
}

type WorkflowTemplateSortField = NonNullable<WorkflowTemplateQuery["sortBy"]>;
type WorkflowTemplateSortOrder = NonNullable<
  WorkflowTemplateQuery["sortOrder"]
>;

const statusIcons: Record<WorkflowTemplateStatus, React.ReactElement> = {
  active: <ActiveIcon />,
  inactive: <InactiveIcon />,
  draft: <DraftIcon />,
};

const statusColors: Record<
  WorkflowTemplateStatus,
  "success" | "warning" | "default"
> = {
  active: "success",
  inactive: "warning",
  draft: "default",
};

const WORKFLOW_TEMPLATE_STATUSES = [
  "active",
  "inactive",
  "draft",
] as const satisfies readonly WorkflowTemplateStatus[];

export const WorkflowTemplatesList: React.FC<WorkflowTemplatesListProps> = ({
  onTemplateSelect,
  onTemplateExecute,
  onTemplateView,
}) => {
  const { t } = useTranslation();

  // URL-based filter state management
  const [searchTerm, setSearchTerm] = useQueryState(
    "search",
    parseAsString.withDefault("")
  );

  const statusParser = parseAsArrayOf(
    parseAsStringEnum([...WORKFLOW_TEMPLATE_STATUSES])
  ).withDefault([]);
  const [selectedStatusesRaw, setSelectedStatusesRaw] = useQueryState(
    "status",
    statusParser
  );

  const selectedStatuses = useMemo(
    () =>
      (selectedStatusesRaw ?? []).filter(
        (status): status is WorkflowTemplateStatus =>
          WORKFLOW_TEMPLATE_STATUSES.includes(status as WorkflowTemplateStatus)
      ),
    [selectedStatusesRaw]
  );

  const [sortBy, setSortBy] = useQueryState(
    "sortBy",
    parseAsStringEnum([
      "name",
      "createdAt",
      "updatedAt",
      "executionCount",
    ]).withDefault("name")
  );

  const [sortOrder, setSortOrder] = useQueryState(
    "sortOrder",
    parseAsStringEnum(["asc", "desc"]).withDefault("asc")
  );

  // Local UI state (not URL-based)
  const [filterMenuAnchor, setFilterMenuAnchor] = useState<null | HTMLElement>(
    null
  );

  // Memoized query object to prevent unnecessary API calls
  const query: WorkflowTemplateQuery = useMemo(
    () => ({
      filters: {
        searchTerm: searchTerm || undefined,
        status: selectedStatuses.length > 0 ? selectedStatuses : undefined,
      },
      sortBy,
      sortOrder,
    }),
    [searchTerm, selectedStatuses, sortBy, sortOrder]
  );

  // Fetch templates using React Query
  const {
    data: templates,
    isLoading,
    error,
    refetch,
  } = useWorkflowTemplates(query);

  const handleStatusToggle = useCallback(
    (status: WorkflowTemplateStatus) => {
      setSelectedStatusesRaw((prev = []) =>
        prev.includes(status)
          ? prev.filter((s) => s !== status)
          : [...prev, status]
      );
    },
    [setSelectedStatusesRaw]
  );

  const handleSortByChange = useCallback(
    (event: SelectChangeEvent) => {
      const rawValue = event.target.value as string;
      const value = (rawValue || "name") as WorkflowTemplateSortField;
      setSortBy(value);
    },
    [setSortBy]
  );

  const handleSortOrderChange = useCallback(
    (event: SelectChangeEvent) => {
      const rawValue = event.target.value as string;
      const value = (rawValue || "asc") as WorkflowTemplateSortOrder;
      setSortOrder(value);
    },
    [setSortOrder]
  );

  const handleClearFilters = useCallback(() => {
    setSearchTerm("");
    setSelectedStatusesRaw([]);
    setSortBy("name" as WorkflowTemplateSortField);
    setSortOrder("asc" as WorkflowTemplateSortOrder);
  }, [setSearchTerm, setSelectedStatusesRaw, setSortBy, setSortOrder]);

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return t("workflow.never");
    return new Date(dateString).toLocaleDateString();
  };

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          {t("workflow.errors.loadTemplates", { error: error.message })}
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box
        sx={{
          mb: 3,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="h4" component="h1">
          {t("workflow.templates.title")}
        </Typography>
        <Tooltip title={t("workflow.actions.refresh")}>
          <IconButton onClick={() => refetch()}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Search and Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              placeholder={t("workflow.templates.searchPlaceholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <FormControl fullWidth>
              <InputLabel>{t("workflow.templates.sortBy")}</InputLabel>
              <Select
                value={sortBy}
                onChange={handleSortByChange}
                label={t("workflow.templates.sortBy")}
              >
                <MenuItem value="name">{t("workflow.fields.name")}</MenuItem>
                <MenuItem value="createdAt">
                  {t("workflow.fields.created")}
                </MenuItem>
                <MenuItem value="updatedAt">
                  {t("workflow.fields.updated")}
                </MenuItem>
                <MenuItem value="executionCount">
                  {t("workflow.fields.executions")}
                </MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <FormControl fullWidth>
              <InputLabel>{t("workflow.templates.order")}</InputLabel>
              <Select
                value={sortOrder}
                onChange={handleSortOrderChange}
                label={t("workflow.templates.order")}
              >
                <MenuItem value="asc">{t("workflow.sort.ascending")}</MenuItem>
                <MenuItem value="desc">
                  {t("workflow.sort.descending")}
                </MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, md: 1 }}>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Tooltip title={t("workflow.templates.filters")}>
                <IconButton
                  onClick={(e) => setFilterMenuAnchor(e.currentTarget)}
                  color={selectedStatuses.length > 0 ? "primary" : "default"}
                >
                  <FilterIcon />
                  {selectedStatuses.length > 0 && (
                    <Chip
                      size="small"
                      label={selectedStatuses.length}
                      color="primary"
                      sx={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        minHeight: 20,
                      }}
                    />
                  )}
                </IconButton>
              </Tooltip>
            </Box>
          </Grid>
        </Grid>

        {/* Active Filters Display */}
        {(searchTerm || selectedStatuses.length > 0) && (
          <Box
            sx={{
              mt: 2,
              display: "flex",
              flexWrap: "wrap",
              gap: 1,
              alignItems: "center",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {t("workflow.templates.activeFilters")}:
            </Typography>
            {searchTerm && (
              <Chip
                size="small"
                label={`${t("workflow.fields.search")}: ${searchTerm}`}
                onDelete={() => setSearchTerm("")}
              />
            )}
            {selectedStatuses.map((status) => (
              <Chip
                key={status}
                size="small"
                label={t(`workflow.status.${status}`)}
                icon={statusIcons[status]}
                color={statusColors[status]}
                onDelete={() => handleStatusToggle(status)}
              />
            ))}
            <Button size="small" onClick={handleClearFilters}>
              {t("workflow.actions.clearFilters")}
            </Button>
          </Box>
        )}
      </Paper>

      {/* Filter Menu */}
      <Menu
        anchorEl={filterMenuAnchor}
        open={Boolean(filterMenuAnchor)}
        onClose={() => setFilterMenuAnchor(null)}
        PaperProps={{ sx: { p: 2, minWidth: 250 } }}
      >
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t("workflow.templates.filterByStatus")}
        </Typography>
        <FormGroup>
          {WORKFLOW_TEMPLATE_STATUSES.map((status) => (
            <FormControlLabel
              key={status}
              control={
                <Checkbox
                  checked={selectedStatuses.includes(status)}
                  onChange={() => handleStatusToggle(status)}
                  size="small"
                />
              }
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {statusIcons[status]}
                  {t(`workflow.status.${status}`)}
                </Box>
              }
            />
          ))}
        </FormGroup>
        <Divider sx={{ my: 1 }} />
        <Button
          size="small"
          fullWidth
          onClick={() => setFilterMenuAnchor(null)}
        >
          {t("workflow.actions.close")}
        </Button>
      </Menu>

      {/* Templates Grid */}
      <AnimatePresence mode="wait">
        {isLoading ? (
          <Grid container spacing={3}>
            {[1, 2, 3, 4].map((i) => (
              <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={i}>
                <Card>
                  <CardContent>
                    <Skeleton variant="text" width="60%" height={32} />
                    <Skeleton variant="text" width="100%" />
                    <Skeleton variant="text" width="80%" />
                    <Box sx={{ mt: 2 }}>
                      <Skeleton variant="rectangular" height={40} />
                    </Box>
                  </CardContent>
                  <Skeleton variant="rectangular" height={52} />
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : templates && templates.length > 0 ? (
          <Grid container spacing={3}>
            {templates.map((template) => (
              <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={template.id}>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <Card
                    sx={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      "&:hover": {
                        boxShadow: 3,
                        transform: "translateY(-2px)",
                        transition: "all 0.3s ease",
                      },
                    }}
                  >
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          mb: 2,
                        }}
                      >
                        <Typography
                          variant="h6"
                          component="h2"
                          sx={{ flexGrow: 1 }}
                        >
                          {template.name}
                        </Typography>
                        <Chip
                          size="small"
                          icon={statusIcons[template.status]}
                          label={t(`workflow.status.${template.status}`)}
                          color={statusColors[template.status]}
                        />
                      </Box>

                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 2 }}
                      >
                        {template.description}
                      </Typography>

                      <Box
                        sx={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 1,
                        }}
                      >
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <CategoryIcon fontSize="small" color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {t("workflow.fields.nodes")}: {template.nodeCount}
                          </Typography>
                        </Box>
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <MetricsIcon fontSize="small" color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {t("workflow.fields.executions")}:{" "}
                            {template.executionCount}
                          </Typography>
                        </Box>
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <ScheduleIcon fontSize="small" color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {t("workflow.fields.lastExecuted")}:{" "}
                            {formatDate(template.lastExecuted)}
                          </Typography>
                        </Box>
                      </Box>
                    </CardContent>

                    <CardActions
                      sx={{ justifyContent: "space-between", px: 2, pb: 2 }}
                    >
                      <Button
                        size="small"
                        startIcon={<ViewIcon />}
                        component="a"
                        href={`/playground?templateId=${template.id}`}
                        onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                          // Allow Ctrl+click, middle-click, right-click to work normally
                          if (
                            !e.ctrlKey &&
                            !e.metaKey &&
                            !e.shiftKey &&
                            e.button !== 1
                          ) {
                            e.preventDefault();
                            onTemplateView?.(template.id);
                          }
                        }}
                      >
                        {t("workflow.actions.view")}
                      </Button>
                      <Box sx={{ display: "flex", gap: 1 }}>
                        {template.status === "active" && onTemplateExecute && (
                          <Tooltip title={t("workflow.actions.execute")}>
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => onTemplateExecute(template.id)}
                            >
                              <PlayIcon />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Button
                          size="small"
                          variant="contained"
                          component="a"
                          href={`/playground?templateId=${template.id}`}
                          onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                            // Allow Ctrl+click, middle-click, right-click to work normally
                            if (
                              !e.ctrlKey &&
                              !e.metaKey &&
                              !e.shiftKey &&
                              e.button !== 1
                            ) {
                              e.preventDefault();
                              onTemplateSelect(template.id);
                            }
                          }}
                        >
                          {t("workflow.actions.details")}
                        </Button>
                      </Box>
                    </CardActions>
                  </Card>
                </motion.div>
              </Grid>
            ))}
          </Grid>
        ) : (
          <Box sx={{ textAlign: "center", py: 8 }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              {t("workflow.templates.noResults")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("workflow.templates.tryAdjustingFilters")}
            </Typography>
          </Box>
        )}
      </AnimatePresence>
    </Box>
  );
};
