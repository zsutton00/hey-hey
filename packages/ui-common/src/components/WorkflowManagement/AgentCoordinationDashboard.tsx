/**
 * Agent Coordination Dashboard Component
 *
 * Monitors agent pool status, coordination events,
 * and task distribution across agents
 */

import React from "react";
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Paper,
  Alert,
  LinearProgress,
  Avatar,
  Tooltip,
} from "@mui/material";
import AgentIcon from "@mui/icons-material/SmartToy";
import CoordinationIcon from "@mui/icons-material/Psychology";
import TaskIcon from "@mui/icons-material/Task";
import StatsIcon from "@mui/icons-material/TrendingUp";
import CompletedIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import PendingIcon from "@mui/icons-material/Schedule";
import RunningIcon from "@mui/icons-material/PlayArrow";
import RegisteredIcon from "@mui/icons-material/PersonAdd";
import DisconnectedIcon from "@mui/icons-material/PersonRemove";
import AssignedIcon from "@mui/icons-material/Assignment";
import EventsIcon from "@mui/icons-material/Timeline";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../i18n/keys";
import {
  useAgentCoordination,
  useCoordinationEvents,
} from "../../hooks/useWorkflowData";
import type {
  AgentCoordinator,
  CoordinationEvent,
  AgentInfo,
  CoordinationTask,
  AgentStatus,
} from "../../types/workflow";

interface AgentCoordinationDashboardProps {
  workflowId: string;
}

interface AgentStatusCardProps {
  agent: AgentInfo;
}

interface TaskStatsCardProps {
  title: string;
  value: number;
  icon: React.ReactElement;
  color?: "primary" | "success" | "warning" | "error" | "info";
}

const getAgentStatusColor = (
  status: AgentStatus
): "success" | "warning" | "error" | "default" => {
  switch (status) {
    case "idle":
      return "success";
    case "busy":
      return "warning";
    case "error":
      return "error";
    case "offline":
      return "default";
    default:
      return "default";
  }
};

const EVENT_TYPE_TRANSLATIONS: Record<CoordinationEvent["type"], string> = {
  agent_registered: KEYS.workflow.agents.agentRegistered,
  agent_disconnected: KEYS.workflow.agents.agentDisconnected,
  task_assigned: KEYS.workflow.agents.taskAssigned,
  task_completed: KEYS.workflow.agents.taskCompleted,
  task_failed: KEYS.workflow.agents.taskFailed,
};

const getEventIcon = (type: CoordinationEvent["type"]): React.ReactElement => {
  switch (type) {
    case "agent_registered":
      return <RegisteredIcon color="success" />;
    case "agent_disconnected":
      return <DisconnectedIcon color="error" />;
    case "task_assigned":
      return <AssignedIcon color="info" />;
    case "task_completed":
      return <CompletedIcon color="success" />;
    case "task_failed":
      return <ErrorIcon color="error" />;
    default:
      return <EventsIcon />;
  }
};

const TaskStatsCard: React.FC<TaskStatsCardProps> = ({
  title,
  value,
  icon,
  color = "primary",
}) => {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
          <Box sx={{ color: `${color}.main`, mr: 2 }}>{icon}</Box>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {title}
          </Typography>
        </Box>
        <Typography variant="h4" color={`${color}.main`}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
};

const AgentStatusCard: React.FC<AgentStatusCardProps> = ({ agent }) => {
  const { t } = useTranslation();

  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <Avatar
            sx={{ width: 32, height: 32, mr: 2, bgcolor: "primary.main" }}
          >
            <AgentIcon fontSize="small" />
          </Avatar>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="subtitle2" noWrap>
              {agent.id}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Chip
                label={t(KEYS.workflow.agents.status[agent.status])}
                color={getAgentStatusColor(agent.status)}
                size="small"
                variant="outlined"
              />
            </Box>
          </Box>
        </Box>

        {agent.currentTask && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 1 }}
          >
            Current: {agent.currentTask}
          </Typography>
        )}

        <Box sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Workload: {agent.workload}%
          </Typography>
          <LinearProgress
            variant="determinate"
            value={agent.workload}
            sx={{ height: 4, borderRadius: 2 }}
            color={
              agent.workload > 80
                ? "error"
                : agent.workload > 60
                ? "warning"
                : "success"
            }
          />
        </Box>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block" }}
        >
          Last activity: {new Date(agent.lastActivity).toLocaleTimeString()}
        </Typography>

        {agent.capabilities.length > 0 && (
          <Box sx={{ mt: 1, display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {agent.capabilities.slice(0, 3).map((capability) => (
              <Chip
                key={capability}
                label={capability}
                size="small"
                variant="outlined"
                sx={{ fontSize: "0.7rem", height: 20 }}
              />
            ))}
            {agent.capabilities.length > 3 && (
              <Tooltip title={agent.capabilities.slice(3).join(", ")}>
                <Chip
                  label={`+${agent.capabilities.length - 3}`}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: "0.7rem", height: 20 }}
                />
              </Tooltip>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export const AgentCoordinationDashboard: React.FC<
  AgentCoordinationDashboardProps
> = ({ workflowId }) => {
  const { t } = useTranslation();

  const {
    data: coordinationData,
    isLoading: coordinationLoading,
    error: coordinationError,
  } = useAgentCoordination(workflowId);

  const {
    data: eventsData,
    isLoading: eventsLoading,
    error: eventsError,
  } = useCoordinationEvents(workflowId);

  const coordinator: AgentCoordinator | undefined =
    coordinationData?.data.coordinator;
  const events: CoordinationEvent[] = eventsData || [];

  const isLoading = coordinationLoading || eventsLoading;
  const hasError = coordinationError || eventsError;

  // Convert Map to array for rendering
  const agents: AgentInfo[] = coordinator
    ? Array.from(coordinator.activeAgents.values())
    : [];
  const tasks: CoordinationTask[] = coordinator?.taskQueue || [];

  // Calculate task statistics
  const taskStats = {
    pending: tasks.filter((task) => task.status === "PENDING").length,
    running: tasks.filter((task) => task.status === "IN_PROGRESS").length,
    completed: tasks.filter((task) => task.status === "COMPLETED").length,
    failed: tasks.filter(
      (task) => task.status === "BLOCKED" || task.status === "CANCELLED"
    ).length,
  };

  if (hasError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Error loading agent coordination data:{" "}
          {hasError.message || "Unknown error"}
        </Alert>
      </Box>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" component="h1" gutterBottom>
          {t(KEYS.workflow.agents.title)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Monitor agent pool status and coordination events
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Agent Pool Overview */}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TaskStatsCard
            title={t(KEYS.workflow.agents.activeAgents)}
            value={agents.length}
            icon={<AgentIcon />}
            color="primary"
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TaskStatsCard
            title={t(KEYS.workflow.agents.tasksProcessed)}
            value={coordinator?.metrics.totalTasksProcessed || 0}
            icon={<StatsIcon />}
            color="success"
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TaskStatsCard
            title="Success Rate"
            value={Math.round((coordinator?.metrics.successRate || 0) * 100)}
            icon={<CompletedIcon />}
            color="success"
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TaskStatsCard
            title="Active Tasks"
            value={coordinator?.metrics.activeTasksCount || 0}
            icon={<TaskIcon />}
            color="warning"
          />
        </Grid>

        {/* Task Queue Status */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Task Queue Status
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {isLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : (
                <List dense>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemIcon>
                      <PendingIcon color="info" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Pending Tasks"
                      secondary={taskStats.pending}
                    />
                  </ListItem>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemIcon>
                      <RunningIcon color="warning" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Running Tasks"
                      secondary={taskStats.running}
                    />
                  </ListItem>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemIcon>
                      <CompletedIcon color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Completed Tasks"
                      secondary={taskStats.completed}
                    />
                  </ListItem>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemIcon>
                      <ErrorIcon color="error" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Failed Tasks"
                      secondary={taskStats.failed}
                    />
                  </ListItem>
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Active Agents */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {t(KEYS.workflow.agents.poolStatus)}
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {isLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
                  <CircularProgress />
                </Box>
              ) : agents.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: "center", p: 2 }}
                >
                  No active agents
                </Typography>
              ) : (
                <Grid container spacing={2}>
                  {agents.map((agent) => (
                    <Grid key={agent.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                      <AgentStatusCard agent={agent} />
                    </Grid>
                  ))}
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Coordination Events */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                <CoordinationIcon sx={{ mr: 1, verticalAlign: "bottom" }} />
                {t(KEYS.workflow.agents.coordinationEvents)}
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {isLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
                  <CircularProgress />
                </Box>
              ) : events.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: "center", p: 2 }}
                >
                  No recent coordination events
                </Typography>
              ) : (
                <List>
                  {events.slice(0, 10).map((event, index) => (
                    <React.Fragment key={event.id}>
                      <ListItem sx={{ px: 0 }}>
                        <ListItemIcon>{getEventIcon(event.type)}</ListItemIcon>
                        <ListItemText
                          primary={
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                              }}
                            >
                              <Typography variant="body2">
                                {t(EVENT_TYPE_TRANSLATIONS[event.type])}
                              </Typography>
                              {event.agentId && (
                                <Chip
                                  label={event.agentId}
                                  size="small"
                                  variant="outlined"
                                />
                              )}
                            </Box>
                          }
                          secondary={
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 2,
                              }}
                            >
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {new Date(event.timestamp).toLocaleString()}
                              </Typography>
                              {event.taskId && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  Task: {event.taskId}
                                </Typography>
                              )}
                            </Box>
                          }
                        />
                      </ListItem>
                      {index < Math.min(events.length, 10) - 1 && <Divider />}
                    </React.Fragment>
                  ))}
                  {events.length > 10 && (
                    <ListItem sx={{ px: 0 }}>
                      <Typography variant="caption" color="text.secondary">
                        +{events.length - 10} more events
                      </Typography>
                    </ListItem>
                  )}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Performance Metrics */}
        {coordinator && (
          <Grid size={{ xs: 12 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Performance Metrics
                </Typography>
                <Divider sx={{ mb: 2 }} />

                <Grid container spacing={3}>
                  <Grid size={{ xs: 12, md: 3 }}>
                    <Box sx={{ textAlign: "center" }}>
                      <Typography variant="h4" color="primary.main">
                        {coordinator.metrics.totalTasksProcessed}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Total Tasks Processed
                      </Typography>
                    </Box>
                  </Grid>

                  <Grid size={{ xs: 12, md: 3 }}>
                    <Box sx={{ textAlign: "center" }}>
                      <Typography variant="h4" color="success.main">
                        {(coordinator.metrics.successRate * 100).toFixed(1)}%
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Success Rate
                      </Typography>
                    </Box>
                  </Grid>

                  <Grid size={{ xs: 12, md: 3 }}>
                    <Box sx={{ textAlign: "center" }}>
                      <Typography variant="h4" color="info.main">
                        {coordinator.metrics.averageTaskDuration.toFixed(1)}s
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Avg Task Duration
                      </Typography>
                    </Box>
                  </Grid>

                  <Grid size={{ xs: 12, md: 3 }}>
                    <Box sx={{ textAlign: "center" }}>
                      <Typography variant="h4" color="warning.main">
                        {coordinator.metrics.activeTasksCount}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Active Tasks
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>
    </Paper>
  );
};
