import React, { useState } from "react";
import {
  Box,
  Typography,
  Paper,
  Button,
  TextField,
  Card,
  CardContent,
  CardHeader,
  Alert,
  CircularProgress,
  Chip,
  List,
  ListItem,
  ListItemText,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import Grid from "@mui/material/GridLegacy";
import { styled } from "@mui/material/styles";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";

const StyledCard = styled(Card)(({ theme }) => ({
  marginBottom: theme.spacing(2),
  "& .MuiCardHeader-root": {
    paddingBottom: theme.spacing(1),
  },
}));

const StatsCard = styled(Card)(({ theme }) => ({
  textAlign: "center",
  "& .MuiCardContent-root": {
    padding: theme.spacing(2),
    "&:last-child": {
      paddingBottom: theme.spacing(2),
    },
  },
}));

const MetricValue = styled(Typography)(({ theme }) => ({
  fontSize: "2rem",
  fontWeight: "bold",
  color: theme.palette.primary.main,
}));

const MetricLabel = styled(Typography)(({ theme }) => ({
  fontSize: "0.875rem",
  color: theme.palette.text.secondary,
  textTransform: "uppercase",
}));

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`debug-tabpanel-${index}`}
      aria-labelledby={`debug-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

interface ProjectDebugData {
  projectId: string;
  organizationId: string;
  project: {
    id: string;
    name: string;
    description?: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  conversations: {
    total: number;
    active: number;
    completed: number;
    failed: number;
    recent: Array<{
      id: string;
      title?: string;
      status: string;
      category: string;
      initiatedBy: string;
      createdAt: string;
      updatedAt: string;
      messageCount: number;
    }>;
  };
  messages: {
    total: number;
    byType: {
      USER: number;
      SYSTEM: number;
    };
    byStatus: Record<string, number>;
    recent: Array<{
      id: string;
      type: string;
      status: string;
      conversationId: string;
      createdAt: string;
      parentMessageId?: string;
    }>;
  };
  artifacts: {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    withEmbeddings: number;
    recent: Array<{
      id: string;
      type: string;
      title?: string;
      status: string;
      sourceType?: string;
      sourceId?: string;
      hasEmbedding: boolean;
      createdAt: string;
    }>;
  };
  events?: {
    total: number;
    byType: Record<string, number>;
    recent: Array<{
      id: string;
      eventType: string;
      aggregateId: string;
      eventData: any;
      createdAt: string;
    }>;
  };
  summary: {
    totalEntities: number;
    lastActivity: string;
    activeSince: string;
  };
}

export default function ProjectDebugView() {
  const [projectId, setProjectId] = useState("");
  const [debugData, setDebugData] = useState<ProjectDebugData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tabValue, setTabValue] = useState(0);

  const API_BASE =
    process.env.REACT_APP_API_URL || "http://localhost:3000/api/v1";

  const loadProjectDebugView = async () => {
    if (!projectId.trim()) {
      setError("Please enter a project ID");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE}/debug/projects/view?projectId=${projectId}`,
        {
          headers: {
            // Add auth headers if needed
            // 'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      setDebugData(result.data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "active":
      case "completed":
      case "success":
        return "success";
      case "failed":
      case "error":
        return "error";
      case "in_progress":
      case "started":
        return "info";
      default:
        return "default";
    }
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Project Debug View
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Comprehensive view of all project-related entities for debugging and
        administration
      </Typography>

      {/* Project ID Input */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid xs={12} md={8}>
            <TextField
              fullWidth
              label="Project ID"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="Enter project ID to debug"
              helperText="Enter the UUID of the project you want to analyze"
            />
          </Grid>
          <Grid xs={12} md={4}>
            <Button
              variant="contained"
              onClick={loadProjectDebugView}
              disabled={loading || !projectId.trim()}
              fullWidth
              size="large"
            >
              {loading && <CircularProgress size={20} sx={{ mr: 1 }} />}
              Load Debug View
            </Button>
          </Grid>
        </Grid>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Paper>

      {/* Debug Data Display */}
      {debugData && (
        <Box>
          {/* Project Info */}
          <StyledCard>
            <CardHeader
              title={`Project: ${debugData.project.name}`}
              subheader={`ID: ${debugData.project.id}`}
            />
            <CardContent>
              <Grid container spacing={2}>
                <Grid xs={12} md={6}>
                  <Typography variant="body2">
                    <strong>Status:</strong>{" "}
                    <Chip
                      label={debugData.project.status}
                      color={getStatusColor(debugData.project.status) as any}
                      size="small"
                      sx={{ ml: 1 }}
                    />
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    <strong>Description:</strong>{" "}
                    {debugData.project.description || "No description"}
                  </Typography>
                </Grid>
                <Grid xs={12} md={6}>
                  <Typography variant="body2">
                    <strong>Created:</strong>{" "}
                    {formatDate(debugData.project.createdAt)}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    <strong>Updated:</strong>{" "}
                    {formatDate(debugData.project.updatedAt)}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </StyledCard>

          {/* Summary Stats */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid xs={12} md={3}>
              <StatsCard>
                <CardContent>
                  <MetricValue>{debugData.summary.totalEntities}</MetricValue>
                  <MetricLabel>Total Entities</MetricLabel>
                </CardContent>
              </StatsCard>
            </Grid>
            <Grid xs={12} md={3}>
              <StatsCard>
                <CardContent>
                  <MetricValue>{debugData.conversations.total}</MetricValue>
                  <MetricLabel>Conversations</MetricLabel>
                </CardContent>
              </StatsCard>
            </Grid>
            <Grid xs={12} md={3}>
              <StatsCard>
                <CardContent>
                  <MetricValue>{debugData.messages.total}</MetricValue>
                  <MetricLabel>Messages</MetricLabel>
                </CardContent>
              </StatsCard>
            </Grid>
            <Grid xs={12} md={3}>
              <StatsCard>
                <CardContent>
                  <MetricValue>{debugData.artifacts.total}</MetricValue>
                  <MetricLabel>Artifacts</MetricLabel>
                </CardContent>
              </StatsCard>
            </Grid>
          </Grid>

          {/* Detailed Views in Tabs */}
          <Paper sx={{ width: "100%" }}>
            <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
              <Tabs value={tabValue} onChange={handleTabChange}>
                <Tab label="Conversations" />
                <Tab label="Messages" />
                <Tab label="Artifacts" />
                {debugData.events && <Tab label="Events" />}
              </Tabs>
            </Box>

            {/* Conversations Tab */}
            <TabPanel value={tabValue} index={0}>
              <Grid container spacing={3}>
                <Grid xs={12} md={4}>
                  <Typography variant="h6" gutterBottom>
                    Status Distribution
                  </Typography>
                  <List dense>
                    <ListItem>
                      <ListItemText
                        primary={`Active: ${debugData.conversations.active}`}
                        secondary="Started or In Progress"
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemText
                        primary={`Completed: ${debugData.conversations.completed}`}
                        secondary="Successfully finished"
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemText
                        primary={`Failed: ${debugData.conversations.failed}`}
                        secondary="Ended with errors"
                      />
                    </ListItem>
                  </List>
                </Grid>
                <Grid xs={12} md={8}>
                  <Typography variant="h6" gutterBottom>
                    Recent Conversations
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>ID</TableCell>
                          <TableCell>Title</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Category</TableCell>
                          <TableCell>Messages</TableCell>
                          <TableCell>Created</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {debugData.conversations.recent.map((conv) => (
                          <TableRow key={conv.id}>
                            <TableCell
                              sx={{
                                fontFamily: "monospace",
                                fontSize: "0.75rem",
                              }}
                            >
                              {conv.id.substring(0, 8)}...
                            </TableCell>
                            <TableCell>{conv.title || "No title"}</TableCell>
                            <TableCell>
                              <Chip
                                label={conv.status}
                                color={getStatusColor(conv.status) as any}
                                size="small"
                              />
                            </TableCell>
                            <TableCell>{conv.category}</TableCell>
                            <TableCell>{conv.messageCount}</TableCell>
                            <TableCell>{formatDate(conv.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Grid>
              </Grid>
            </TabPanel>

            {/* Messages Tab */}
            <TabPanel value={tabValue} index={1}>
              <Grid container spacing={3}>
                <Grid xs={12} md={4}>
                  <Typography variant="h6" gutterBottom>
                    Type Distribution
                  </Typography>
                  <List dense>
                    <ListItem>
                      <ListItemText
                        primary={`User Messages: ${debugData.messages.byType.USER}`}
                        secondary="Messages from users"
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemText
                        primary={`System Messages: ${debugData.messages.byType.SYSTEM}`}
                        secondary="Messages from system"
                      />
                    </ListItem>
                  </List>

                  <Typography variant="h6" sx={{ mt: 3 }} gutterBottom>
                    Status Distribution
                  </Typography>
                  <List dense>
                    {Object.entries(debugData.messages.byStatus).map(
                      ([status, count]) => (
                        <ListItem key={status}>
                          <ListItemText primary={`${status}: ${count}`} />
                        </ListItem>
                      )
                    )}
                  </List>
                </Grid>
                <Grid xs={12} md={8}>
                  <Typography variant="h6" gutterBottom>
                    Recent Messages
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>ID</TableCell>
                          <TableCell>Type</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Conversation</TableCell>
                          <TableCell>Parent</TableCell>
                          <TableCell>Created</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {debugData.messages.recent.map((msg) => (
                          <TableRow key={msg.id}>
                            <TableCell
                              sx={{
                                fontFamily: "monospace",
                                fontSize: "0.75rem",
                              }}
                            >
                              {msg.id.substring(0, 8)}...
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={msg.type}
                                color={
                                  msg.type === "USER" ? "primary" : "secondary"
                                }
                                size="small"
                              />
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={msg.status}
                                color={getStatusColor(msg.status) as any}
                                size="small"
                              />
                            </TableCell>
                            <TableCell
                              sx={{
                                fontFamily: "monospace",
                                fontSize: "0.75rem",
                              }}
                            >
                              {msg.conversationId.substring(0, 8)}...
                            </TableCell>
                            <TableCell
                              sx={{
                                fontFamily: "monospace",
                                fontSize: "0.75rem",
                              }}
                            >
                              {msg.parentMessageId
                                ? `${msg.parentMessageId.substring(0, 8)}...`
                                : "-"}
                            </TableCell>
                            <TableCell>{formatDate(msg.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Grid>
              </Grid>
            </TabPanel>

            {/* Artifacts Tab */}
            <TabPanel value={tabValue} index={2}>
              <Grid container spacing={3}>
                <Grid xs={12} md={4}>
                  <Typography variant="h6" gutterBottom>
                    Type Distribution
                  </Typography>
                  <List dense>
                    {Object.entries(debugData.artifacts.byType).map(
                      ([type, count]) => (
                        <ListItem key={type}>
                          <ListItemText primary={`${type}: ${count}`} />
                        </ListItem>
                      )
                    )}
                  </List>

                  <Typography variant="h6" sx={{ mt: 3 }} gutterBottom>
                    Embeddings
                  </Typography>
                  <List dense>
                    <ListItem>
                      <ListItemText
                        primary={`With Embeddings: ${debugData.artifacts.withEmbeddings}`}
                        secondary={`${
                          debugData.artifacts.total -
                          debugData.artifacts.withEmbeddings
                        } without`}
                      />
                    </ListItem>
                  </List>
                </Grid>
                <Grid xs={12} md={8}>
                  <Typography variant="h6" gutterBottom>
                    Recent Artifacts
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>ID</TableCell>
                          <TableCell>Type</TableCell>
                          <TableCell>Title</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Embedding</TableCell>
                          <TableCell>Source</TableCell>
                          <TableCell>Created</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {debugData.artifacts.recent.map((artifact) => (
                          <TableRow key={artifact.id}>
                            <TableCell
                              sx={{
                                fontFamily: "monospace",
                                fontSize: "0.75rem",
                              }}
                            >
                              {artifact.id.substring(0, 8)}...
                            </TableCell>
                            <TableCell>{artifact.type}</TableCell>
                            <TableCell>
                              {artifact.title || "No title"}
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={artifact.status}
                                color={getStatusColor(artifact.status) as any}
                                size="small"
                              />
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={artifact.hasEmbedding ? "Yes" : "No"}
                                color={
                                  artifact.hasEmbedding ? "success" : "default"
                                }
                                size="small"
                              />
                            </TableCell>
                            <TableCell>
                              {artifact.sourceType
                                ? `${
                                    artifact.sourceType
                                  }:${artifact.sourceId?.substring(0, 8)}...`
                                : "-"}
                            </TableCell>
                            <TableCell>
                              {formatDate(artifact.createdAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Grid>
              </Grid>
            </TabPanel>

            {/* Events Tab */}
            {debugData.events && (
              <TabPanel value={tabValue} index={3}>
                <Grid container spacing={3}>
                  <Grid xs={12} md={4}>
                    <Typography variant="h6" gutterBottom>
                      Event Type Distribution
                    </Typography>
                    <List dense>
                      {Object.entries(debugData.events.byType).map(
                        ([type, count]) => (
                          <ListItem key={type}>
                            <ListItemText primary={`${type}: ${count}`} />
                          </ListItem>
                        )
                      )}
                    </List>
                  </Grid>
                  <Grid xs={12} md={8}>
                    <Typography variant="h6" gutterBottom>
                      Recent Events
                    </Typography>
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>ID</TableCell>
                            <TableCell>Event Type</TableCell>
                            <TableCell>Aggregate ID</TableCell>
                            <TableCell>Created</TableCell>
                            <TableCell>Data</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {debugData.events.recent.map((event) => (
                            <TableRow key={event.id}>
                              <TableCell
                                sx={{
                                  fontFamily: "monospace",
                                  fontSize: "0.75rem",
                                }}
                              >
                                {event.id.substring(0, 8)}...
                              </TableCell>
                              <TableCell>{event.eventType}</TableCell>
                              <TableCell
                                sx={{
                                  fontFamily: "monospace",
                                  fontSize: "0.75rem",
                                }}
                              >
                                {event.aggregateId.substring(0, 8)}...
                              </TableCell>
                              <TableCell>
                                {formatDate(event.createdAt)}
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    alert(
                                      JSON.stringify(event.eventData, null, 2)
                                    );
                                  }}
                                >
                                  View Data
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Grid>
                </Grid>
              </TabPanel>
            )}
          </Paper>
        </Box>
      )}
    </Box>
  );
}
