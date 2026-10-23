/**
 * Workflow Monitoring Dashboard Component
 *
 * Real-time monitoring dashboard for workflow execution metrics,
 * system health, and active alerts
 */

import React from "react";
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Alert,
  Chip,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Divider,
  Paper,
} from "@mui/material";
import ExecutionIcon from "@mui/icons-material/PlayArrow";
import PerformanceIcon from "@mui/icons-material/Speed";
import AgentIcon from "@mui/icons-material/Psychology";
import HealthIcon from "@mui/icons-material/HealthAndSafety";
import WarningIcon from "@mui/icons-material/Warning";
import ErrorIcon from "@mui/icons-material/Error";
import InfoIcon from "@mui/icons-material/Info";
import ScheduleIcon from "@mui/icons-material/Schedule";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../i18n/keys";
import {
  useWorkflowMonitoring,
  useWorkflowHealth,
  useWorkflowAlerts,
} from "../../hooks/useWorkflowData";
import type {
  WorkflowMetrics,
  WorkflowHealthMetrics,
  WorkflowAlert,
  AlertSeverity,
  SystemHealthStatus,
} from "../../types/workflow";

interface WorkflowMonitoringDashboardProps {
  workflowId: string;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  detail?: string;
  icon: React.ReactElement;
  color?: "primary" | "success" | "warning" | "error" | "info";
  isLoading?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  detail,
  icon,
  color = "primary",
  isLoading = false,
}) => {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <Box sx={{ color: `${color}.main`, mr: 2 }}>{icon}</Box>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            {title}
          </Typography>
        </Box>
        {isLoading ? (
          <CircularProgress size={24} />
        ) : (
          <>
            <Typography variant="h4" component="div" gutterBottom>
              {value}
            </Typography>
            {detail && (
              <Typography variant="body2" color="text.secondary">
                {detail}
              </Typography>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

const getAlertSeverityColor = (
  severity: AlertSeverity
): "info" | "warning" | "error" => {
  switch (severity) {
    case "critical":
    case "error":
      return "error";
    case "warning":
      return "warning";
    default:
      return "info";
  }
};

const getAlertIcon = (severity: AlertSeverity): React.ReactElement => {
  switch (severity) {
    case "critical":
    case "error":
      return <ErrorIcon />;
    case "warning":
      return <WarningIcon />;
    default:
      return <InfoIcon />;
  }
};

const getHealthStatusColor = (
  status: SystemHealthStatus
): "success" | "warning" | "error" => {
  switch (status) {
    case "healthy":
      return "success";
    case "degraded":
      return "warning";
    case "unhealthy":
      return "error";
    default:
      return "warning";
  }
};

export const WorkflowMonitoringDashboard: React.FC<
  WorkflowMonitoringDashboardProps
> = ({ workflowId }) => {
  const { t } = useTranslation();

  const {
    data: monitoringData,
    isLoading: monitoringLoading,
    error: monitoringError,
  } = useWorkflowMonitoring(workflowId);

  const {
    data: healthData,
    isLoading: healthLoading,
    error: healthError,
  } = useWorkflowHealth(workflowId);

  const {
    data: alertsData,
    isLoading: alertsLoading,
    error: alertsError,
  } = useWorkflowAlerts(workflowId);

  const metrics: WorkflowMetrics | undefined = monitoringData?.data.metrics;
  const health: WorkflowHealthMetrics | undefined = healthData;
  const alerts: WorkflowAlert[] = alertsData || [];

  const isLoading = monitoringLoading || healthLoading || alertsLoading;
  const hasError = monitoringError || healthError || alertsError;

  const formatDuration = (milliseconds?: number): string => {
    if (!milliseconds) return t(KEYS.workflow.monitoring.inProgress);

    const seconds = Math.floor(milliseconds / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const calculateSuccessRate = (
    executions: number,
    failures: number
  ): number => {
    if (executions === 0) return 100;
    return ((executions - failures) / executions) * 100;
  };

  if (hasError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Error loading monitoring data: {hasError.message || "Unknown error"}
        </Alert>
      </Box>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" component="h1" gutterBottom>
          {t(KEYS.workflow.monitoring.title)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Real-time workflow monitoring and health status
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Execution Status */}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <MetricCard
            title={t(KEYS.workflow.monitoring.executionStatus)}
            value={metrics?.status || "Unknown"}
            detail={metrics ? formatDuration(metrics.duration) : undefined}
            icon={<ExecutionIcon />}
            color="primary"
            isLoading={isLoading}
          />
        </Grid>

        {/* Performance Metrics */}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <MetricCard
            title={t(KEYS.workflow.monitoring.performance)}
            value={
              metrics ? `${metrics.averageStepDuration.toFixed(0)}ms` : "0ms"
            }
            detail={t(KEYS.workflow.monitoring.averageStepDuration)}
            icon={<PerformanceIcon />}
            color="info"
            isLoading={isLoading}
          />
        </Grid>

        {/* Agent Executions */}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <MetricCard
            title={t(KEYS.workflow.monitoring.agentExecutions)}
            value={metrics?.agentExecutions || 0}
            detail={
              metrics
                ? `${t(
                    KEYS.workflow.monitoring.successRate
                  )}: ${calculateSuccessRate(
                    metrics.agentExecutions,
                    metrics.agentFailures
                  ).toFixed(1)}%`
                : undefined
            }
            icon={<AgentIcon />}
            color="success"
            isLoading={isLoading}
          />
        </Grid>

        {/* System Health */}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <MetricCard
            title={t(KEYS.workflow.monitoring.systemHealth)}
            value={
              health
                ? t(KEYS.workflow.monitoring.healthStatus[health.systemStatus])
                : "Unknown"
            }
            detail={
              health
                ? `${t(
                    KEYS.workflow.monitoring.memory
                  )}: ${health.memoryUtilization.toFixed(1)}%`
                : undefined
            }
            icon={<HealthIcon />}
            color={
              health ? getHealthStatusColor(health.systemStatus) : "warning"
            }
            isLoading={isLoading}
          />
        </Grid>

        {/* System Health Details */}
        {health && (
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  System Metrics
                </Typography>
                <Divider sx={{ mb: 2 }} />

                <List dense>
                  <ListItem>
                    <ListItemText
                      primary="Memory Utilization"
                      secondary={`${health.memoryUtilization.toFixed(1)}%`}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemText
                      primary="CPU Utilization"
                      secondary={`${health.cpuUtilization.toFixed(1)}%`}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemText
                      primary="Active Workflows"
                      secondary={health.activeWorkflows}
                    />
                  </ListItem>
                  <ListItem>
                    <ListItemText
                      primary="Queued Workflows"
                      secondary={health.queuedWorkflows}
                    />
                  </ListItem>
                </List>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Active Alerts */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {t(KEYS.workflow.monitoring.activeAlerts)}
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {alerts.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No active alerts
                </Typography>
              ) : (
                <List dense>
                  {alerts.slice(0, 5).map((alert) => (
                    <ListItem key={alert.id} sx={{ px: 0 }}>
                      <Box sx={{ width: "100%" }}>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            mb: 1,
                          }}
                        >
                          {getAlertIcon(alert.severity)}
                          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                            {alert.title}
                          </Typography>
                          <Chip
                            size="small"
                            label={alert.severity}
                            color={getAlertSeverityColor(alert.severity)}
                            variant="outlined"
                          />
                        </Box>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          gutterBottom
                        >
                          {alert.description}
                        </Typography>
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <ScheduleIcon fontSize="small" color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {new Date(alert.timestamp).toLocaleTimeString()}
                          </Typography>
                        </Box>
                      </Box>
                    </ListItem>
                  ))}
                  {alerts.length > 5 && (
                    <ListItem sx={{ px: 0 }}>
                      <Typography variant="caption" color="text.secondary">
                        +{alerts.length - 5} more alerts
                      </Typography>
                    </ListItem>
                  )}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Workflow Timeline */}
        {metrics && (
          <Grid size={{ xs: 12 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Execution Timeline
                </Typography>
                <Divider sx={{ mb: 2 }} />

                <Box
                  sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}
                >
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Started
                    </Typography>
                    <Typography variant="body2">
                      {new Date(metrics.startTime).toLocaleString()}
                    </Typography>
                  </Box>
                  {metrics.endTime && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Ended
                      </Typography>
                      <Typography variant="body2">
                        {new Date(metrics.endTime).toLocaleString()}
                      </Typography>
                    </Box>
                  )}
                  {metrics.currentStep && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Current Step
                      </Typography>
                      <Typography variant="body2">
                        {metrics.currentStep}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>
    </Paper>
  );
};
