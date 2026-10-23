import React, { useState } from "react";
import {
  Box,
  Typography,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Grid,
  LinearProgress,
  Badge,
  Card,
  CardContent,
  Stack,
  Divider,
} from "@mui/material";
import CollectionIcon from "@mui/icons-material/Storage";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SuccessIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import LoadingIcon from "@mui/icons-material/Schedule";
import StaleIcon from "@mui/icons-material/Update";
import OptimisticIcon from "@mui/icons-material/Cached";
import StatsIcon from "@mui/icons-material/TrendingUp";
import { useTranslation } from "react-i18next";
import { useWebSocketDebug } from "../../data/websockets/debug";

interface CollectionDebugProps {
  /** Update interval in milliseconds (default: 1000) */
  updateInterval?: number;
  /** Whether to show detailed query information */
  showDetails?: boolean;
}

export const CollectionDebug: React.FC<CollectionDebugProps> = ({
  updateInterval = 1000,
  showDetails = true,
}) => {
  const { t } = useTranslation();
  const [expandedCollection, setExpandedCollection] = useState<string | false>(
    false
  );

  const { collections } = useWebSocketDebug({ updateInterval });

  const handleAccordionChange =
    (collectionName: string) =>
    (_event: React.SyntheticEvent, isExpanded: boolean) => {
      setExpandedCollection(isExpanded ? collectionName : false);
    };

  const getCollectionHealthIcon = (collection: (typeof collections)[0]) => {
    if (collection.errors.length > 0) return <ErrorIcon color="error" />;
    if (collection.loadingQueries.length > 0)
      return <LoadingIcon color="info" />;
    return <SuccessIcon color="success" />;
  };

  const formatCacheStats = (collection: (typeof collections)[0]) => {
    const totalQueries =
      collection.activeQueries.listQueries +
      collection.activeQueries.singleQueries;
    const staleCount = collection.staleQueries.length;
    const loadingCount = collection.loadingQueries.length;
    const errorCount = collection.errors.length;
    const healthyQueries =
      totalQueries - staleCount - errorCount - loadingCount;
    const healthPercentage =
      totalQueries > 0 ? (healthyQueries / totalQueries) * 100 : 100;

    return {
      totalQueries,
      healthyQueries,
      staleCount,
      loadingCount,
      errorCount,
      healthPercentage,
    };
  };

  return (
    <Box sx={{ maxHeight: "70vh", overflow: "auto" }}>
      {/* Summary Stats */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ pb: "16px !important" }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <CollectionIcon color="primary" />
            <Typography variant="h6" sx={{ flex: 1 }}>
              {t("debug.collections.title", "Collection State")}
            </Typography>
            <Chip
              label={`${collections.length} ${t(
                "debug.collections.total",
                "Collections"
              )}`}
              variant="outlined"
              size="small"
            />
          </Stack>

          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Stack alignItems="center">
                <Typography variant="h6" color="primary">
                  {collections.reduce((sum, c) => sum + c.totalItems, 0)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("debug.collections.totalItems", "Total Items")}
                </Typography>
              </Stack>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Stack alignItems="center">
                <Typography variant="h6" color="success.main">
                  {collections.reduce(
                    (sum, c) =>
                      sum +
                      c.activeQueries.listQueries +
                      c.activeQueries.singleQueries,
                    0
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("debug.collections.activeQueries", "Active Queries")}
                </Typography>
              </Stack>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Stack alignItems="center">
                <Typography variant="h6" color="warning.main">
                  {collections.reduce(
                    (sum, c) => sum + c.staleQueries.length,
                    0
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("debug.collections.staleQueries", "Stale")}
                </Typography>
              </Stack>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Stack alignItems="center">
                <Typography variant="h6" color="error.main">
                  {collections.reduce((sum, c) => sum + c.errors.length, 0)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("debug.collections.errorQueries", "Errors")}
                </Typography>
              </Stack>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Individual Collections */}
      {collections.map((collection) => {
        const stats = formatCacheStats(collection);

        return (
          <Accordion
            key={collection.name}
            expanded={expandedCollection === collection.name}
            onChange={handleAccordionChange(collection.name)}
            sx={{ mb: 1 }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  width: "100%",
                }}
              >
                {getCollectionHealthIcon(collection)}

                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {collection.name}
                </Typography>

                <Box sx={{ display: "flex", gap: 1, ml: "auto", mr: 2 }}>
                  <Chip
                    label={`${collection.totalItems} items`}
                    size="small"
                    variant="outlined"
                  />
                  <Chip
                    label={`${stats.totalQueries} queries`}
                    size="small"
                    variant="outlined"
                    color={stats.totalQueries > 0 ? "primary" : "default"}
                  />
                  {stats.staleCount > 0 && (
                    <Chip
                      label={`${stats.staleCount} stale`}
                      size="small"
                      variant="outlined"
                      color="warning"
                    />
                  )}
                  {stats.loadingCount > 0 && (
                    <Chip
                      label={`${stats.loadingCount} loading`}
                      size="small"
                      variant="outlined"
                      color="info"
                    />
                  )}
                  {stats.errorCount > 0 && (
                    <Chip
                      label={`${stats.errorCount} errors`}
                      size="small"
                      variant="outlined"
                      color="error"
                    />
                  )}
                  {collection.optimisticUpdates > 0 && (
                    <Badge
                      badgeContent={collection.optimisticUpdates}
                      color="info"
                    >
                      <OptimisticIcon fontSize="small" />
                    </Badge>
                  )}
                </Box>
              </Box>
            </AccordionSummary>

            <AccordionDetails>
              {/* Health Progress Bar */}
              <Box sx={{ mb: 3 }}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    mb: 1,
                  }}
                >
                  <Typography variant="body2">
                    {t("debug.collections.health", "Collection Health")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {stats.healthPercentage.toFixed(1)}%
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={stats.healthPercentage}
                  color={
                    stats.healthPercentage > 80
                      ? "success"
                      : stats.healthPercentage > 50
                      ? "warning"
                      : "error"
                  }
                  sx={{ height: 8, borderRadius: 4 }}
                />
              </Box>

              <Grid container spacing={2}>
                {/* Query Status Breakdown */}
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography
                    variant="subtitle2"
                    sx={{
                      mb: 1,
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                    }}
                  >
                    <StatsIcon fontSize="small" />
                    {t("debug.collections.queryStatus", "Query Status")}
                  </Typography>
                  <List dense>
                    <ListItem>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <SuccessIcon color="success" fontSize="small" />
                      </ListItemIcon>
                      <ListItemText
                        primary={`Fresh: ${stats.healthyQueries}`}
                        secondary="Ready and up-to-date"
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <StaleIcon color="warning" fontSize="small" />
                      </ListItemIcon>
                      <ListItemText
                        primary={`Stale: ${collection.staleQueries.length}`}
                        secondary="Needs refresh"
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <LoadingIcon color="info" fontSize="small" />
                      </ListItemIcon>
                      <ListItemText
                        primary={`Loading: ${collection.loadingQueries.length}`}
                        secondary="Currently fetching"
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <ErrorIcon color="error" fontSize="small" />
                      </ListItemIcon>
                      <ListItemText
                        primary={`Error: ${collection.errors.length}`}
                        secondary="Failed to fetch"
                      />
                    </ListItem>
                  </List>
                </Grid>

                {/* Query Types */}
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t("debug.collections.queryTypes", "Query Types")}
                  </Typography>
                  <List dense>
                    <ListItem>
                      <ListItemText
                        primary={`List Queries: ${collection.activeQueries.listQueries}`}
                        secondary="Collection-wide queries"
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemText
                        primary={`Single Queries: ${collection.activeQueries.singleQueries}`}
                        secondary="Individual item queries"
                      />
                    </ListItem>
                    {collection.optimisticUpdates > 0 && (
                      <ListItem>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <OptimisticIcon color="info" fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                          primary={`Optimistic Updates: ${collection.optimisticUpdates}`}
                          secondary="Pending server confirmation"
                        />
                      </ListItem>
                    )}
                  </List>
                </Grid>
              </Grid>

              {showDetails && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t("debug.collections.performance", "Performance Metrics")}
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        Cache Efficiency:{" "}
                        {(
                          (stats.healthyQueries /
                            Math.max(stats.totalQueries, 1)) *
                          100
                        ).toFixed(1)}
                        %
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        Total Items: {collection.totalItems}
                      </Typography>
                    </Grid>
                  </Grid>
                </>
              )}
            </AccordionDetails>
          </Accordion>
        );
      })}

      {collections.length === 0 && (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 4 }}>
            <Typography variant="body1" color="text.secondary">
              {t("debug.collections.noCollections", "No collections available")}
            </Typography>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};
