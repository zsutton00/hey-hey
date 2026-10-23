import { useState } from "react";
import {
  Box,
  Typography,
  Paper,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  CircularProgress,
} from "@mui/material";
import Grid from "@mui/material/GridLegacy";
import { styled } from "@mui/material/styles";
import { getApiBaseUrl } from "@hey-hey/ui-common/services";

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3),
  marginBottom: theme.spacing(2),
}));

const FormSection = styled(Box)(({ theme }) => ({
  marginBottom: theme.spacing(3),
}));

interface LLMRequest {
  organizationId: string;
  projectId: string;
  prompt: string;
  conversationId?: string;
  workflowId?: string;
  messageId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  metadata?: Record<string, any>;
}

interface LLMProgress {
  requestId: string;
  organizationId: string;
  chunk: string;
  tokensGenerated?: number;
  estimatedTotal?: number;
}

interface LLMComplete {
  requestId: string;
  organizationId: string;
  status: "success" | "failed";
  content?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: {
    message: string;
    code: string;
  };
}

export default function LLMDevTools() {
  // Request form state
  const [requestForm, setRequestForm] = useState<LLMRequest>({
    organizationId: "",
    projectId: "",
    prompt: "",
    model: "gpt-4",
    temperature: 0.7,
    maxTokens: 1000,
    stream: false,
  });

  // Progress form state
  const [progressForm, setProgressForm] = useState<LLMProgress>({
    requestId: "",
    organizationId: "",
    chunk: "",
    tokensGenerated: 0,
    estimatedTotal: 200,
  });

  // Complete form state
  const [completeForm, setCompleteForm] = useState<LLMComplete>({
    requestId: "",
    organizationId: "",
    status: "success",
    content: "",
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
  });

  // Simulation form state
  const [simulationForm, setSimulationForm] = useState<
    LLMRequest & { simulateDelay?: number }
  >({
    organizationId: "",
    projectId: "",
    prompt: "",
    model: "gpt-4",
    temperature: 0.7,
    maxTokens: 1000,
    stream: false,
    simulateDelay: 2000,
  });

  // UI state
  const [loading, setLoading] = useState<{ [key: string]: boolean }>({});
  const [results, setResults] = useState<{ [key: string]: any }>({});
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [activeRequests, setActiveRequests] = useState<string[]>([]);

  const API_BASE = getApiBaseUrl();

  const handleApiCall = async (
    endpoint: string,
    data: any,
    formType: string
  ) => {
    setLoading((prev) => ({ ...prev, [formType]: true }));
    setErrors((prev) => ({ ...prev, [formType]: "" }));

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Add auth headers if needed
          // 'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      setResults((prev) => ({ ...prev, [formType]: result }));

      // If this was a request trigger, save the requestId for other forms
      if (formType === "request" && result.data?.requestId) {
        setProgressForm((prev) => ({
          ...prev,
          requestId: result.data.requestId,
        }));
        setCompleteForm((prev) => ({
          ...prev,
          requestId: result.data.requestId,
        }));
      }
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        [formType]: error instanceof Error ? error.message : "Unknown error",
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [formType]: false }));
    }
  };

  const getActiveRequests = async () => {
    setLoading((prev) => ({ ...prev, active: true }));

    try {
      const response = await fetch(`${API_BASE}/dev/llm/active-requests`, {
        headers: {
          // 'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      setActiveRequests(result.data?.activeRequests || []);
      setResults((prev) => ({ ...prev, active: result }));
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        active: error instanceof Error ? error.message : "Unknown error",
      }));
    } finally {
      setLoading((prev) => ({ ...prev, active: false }));
    }
  };

  const triggerRequest = () => {
    handleApiCall("/dev/llm/trigger-request", requestForm, "request");
  };

  const triggerProgress = () => {
    handleApiCall("/dev/llm/trigger-progress", progressForm, "progress");
  };

  const triggerComplete = () => {
    handleApiCall("/dev/llm/trigger-complete", completeForm, "complete");
  };

  const simulateFlow = () => {
    handleApiCall("/dev/llm/simulate-flow", simulationForm, "simulation");
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        LLM Development Tools
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Tools for testing and debugging LLM event flows
      </Typography>

      <Grid container spacing={3}>
        {/* Active Requests */}
        <Grid xs={12}>
          <StyledPaper>
            <Typography variant="h6" gutterBottom>
              Active Requests
            </Typography>

            <Button
              variant="outlined"
              onClick={getActiveRequests}
              disabled={loading.active}
              sx={{ mb: 2 }}
            >
              {loading.active && <CircularProgress size={20} sx={{ mr: 1 }} />}
              Refresh Active Requests
            </Button>

            {activeRequests.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2">Active Request IDs:</Typography>
                {activeRequests.map((id, index) => (
                  <Typography
                    key={index}
                    variant="body2"
                    sx={{ fontFamily: "monospace", ml: 2 }}
                  >
                    {id}
                  </Typography>
                ))}
              </Box>
            )}

            {errors.active && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {errors.active}
              </Alert>
            )}

            {results.active && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2">Response:</Typography>
                <pre style={{ fontSize: "12px", overflow: "auto" }}>
                  {JSON.stringify(results.active, null, 2)}
                </pre>
              </Box>
            )}
          </StyledPaper>
        </Grid>

        {/* Trigger Request */}
        <Grid xs={12} md={6}>
          <StyledPaper>
            <Typography variant="h6" gutterBottom>
              Trigger LLM Request
            </Typography>

            <FormSection>
              <TextField
                fullWidth
                label="Organization ID"
                value={requestForm.organizationId}
                onChange={(e) =>
                  setRequestForm((prev) => ({
                    ...prev,
                    organizationId: e.target.value,
                  }))
                }
                margin="normal"
                required
              />
              <TextField
                fullWidth
                label="Project ID"
                value={requestForm.projectId}
                onChange={(e) =>
                  setRequestForm((prev) => ({
                    ...prev,
                    projectId: e.target.value,
                  }))
                }
                margin="normal"
                required
              />
              <TextField
                fullWidth
                label="Prompt"
                value={requestForm.prompt}
                onChange={(e) =>
                  setRequestForm((prev) => ({
                    ...prev,
                    prompt: e.target.value,
                  }))
                }
                margin="normal"
                multiline
                rows={3}
                required
              />
              <TextField
                fullWidth
                label="Conversation ID (optional)"
                value={requestForm.conversationId || ""}
                onChange={(e) =>
                  setRequestForm((prev) => ({
                    ...prev,
                    conversationId: e.target.value,
                  }))
                }
                margin="normal"
              />
              <FormControl fullWidth margin="normal">
                <InputLabel>Model</InputLabel>
                <Select
                  value={requestForm.model}
                  onChange={(e) =>
                    setRequestForm((prev) => ({
                      ...prev,
                      model: e.target.value,
                    }))
                  }
                >
                  <MenuItem value="gpt-4">GPT-4</MenuItem>
                  <MenuItem value="gpt-3.5-turbo">GPT-3.5 Turbo</MenuItem>
                  <MenuItem value="claude-3">Claude 3</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth
                label="Temperature"
                type="number"
                value={requestForm.temperature}
                onChange={(e) =>
                  setRequestForm((prev) => ({
                    ...prev,
                    temperature: parseFloat(e.target.value),
                  }))
                }
                margin="normal"
                inputProps={{ step: 0.1, min: 0, max: 2 }}
              />
              <TextField
                fullWidth
                label="Max Tokens"
                type="number"
                value={requestForm.maxTokens}
                onChange={(e) =>
                  setRequestForm((prev) => ({
                    ...prev,
                    maxTokens: parseInt(e.target.value),
                  }))
                }
                margin="normal"
                inputProps={{ min: 1, max: 8000 }}
              />
            </FormSection>

            <Button
              variant="contained"
              onClick={triggerRequest}
              disabled={
                loading.request ||
                !requestForm.organizationId ||
                !requestForm.projectId ||
                !requestForm.prompt
              }
              fullWidth
            >
              {loading.request && <CircularProgress size={20} sx={{ mr: 1 }} />}
              Trigger Request
            </Button>

            {errors.request && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {errors.request}
              </Alert>
            )}

            {results.request && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2">Response:</Typography>
                <pre style={{ fontSize: "12px", overflow: "auto" }}>
                  {JSON.stringify(results.request, null, 2)}
                </pre>
              </Box>
            )}
          </StyledPaper>
        </Grid>

        {/* Trigger Progress */}
        <Grid xs={12} md={6}>
          <StyledPaper>
            <Typography variant="h6" gutterBottom>
              Trigger Progress Event
            </Typography>

            <FormSection>
              <TextField
                fullWidth
                label="Request ID"
                value={progressForm.requestId}
                onChange={(e) =>
                  setProgressForm((prev) => ({
                    ...prev,
                    requestId: e.target.value,
                  }))
                }
                margin="normal"
                required
                helperText="Use Request ID from trigger request response"
              />
              <TextField
                fullWidth
                label="Organization ID"
                value={progressForm.organizationId}
                onChange={(e) =>
                  setProgressForm((prev) => ({
                    ...prev,
                    organizationId: e.target.value,
                  }))
                }
                margin="normal"
                required
              />
              <TextField
                fullWidth
                label="Progress Chunk"
                value={progressForm.chunk}
                onChange={(e) =>
                  setProgressForm((prev) => ({
                    ...prev,
                    chunk: e.target.value,
                  }))
                }
                margin="normal"
                multiline
                rows={2}
                required
              />
              <TextField
                fullWidth
                label="Tokens Generated"
                type="number"
                value={progressForm.tokensGenerated}
                onChange={(e) =>
                  setProgressForm((prev) => ({
                    ...prev,
                    tokensGenerated: parseInt(e.target.value),
                  }))
                }
                margin="normal"
                inputProps={{ min: 0 }}
              />
              <TextField
                fullWidth
                label="Estimated Total"
                type="number"
                value={progressForm.estimatedTotal}
                onChange={(e) =>
                  setProgressForm((prev) => ({
                    ...prev,
                    estimatedTotal: parseInt(e.target.value),
                  }))
                }
                margin="normal"
                inputProps={{ min: 1 }}
              />
            </FormSection>

            <Button
              variant="contained"
              onClick={triggerProgress}
              disabled={
                loading.progress ||
                !progressForm.requestId ||
                !progressForm.organizationId ||
                !progressForm.chunk
              }
              fullWidth
            >
              {loading.progress && (
                <CircularProgress size={20} sx={{ mr: 1 }} />
              )}
              Trigger Progress
            </Button>

            {errors.progress && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {errors.progress}
              </Alert>
            )}

            {results.progress && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2">Response:</Typography>
                <pre style={{ fontSize: "12px", overflow: "auto" }}>
                  {JSON.stringify(results.progress, null, 2)}
                </pre>
              </Box>
            )}
          </StyledPaper>
        </Grid>

        {/* Trigger Complete */}
        <Grid xs={12} md={6}>
          <StyledPaper>
            <Typography variant="h6" gutterBottom>
              Trigger Completion Event
            </Typography>

            <FormSection>
              <TextField
                fullWidth
                label="Request ID"
                value={completeForm.requestId}
                onChange={(e) =>
                  setCompleteForm((prev) => ({
                    ...prev,
                    requestId: e.target.value,
                  }))
                }
                margin="normal"
                required
                helperText="Use Request ID from trigger request response"
              />
              <TextField
                fullWidth
                label="Organization ID"
                value={completeForm.organizationId}
                onChange={(e) =>
                  setCompleteForm((prev) => ({
                    ...prev,
                    organizationId: e.target.value,
                  }))
                }
                margin="normal"
                required
              />
              <FormControl fullWidth margin="normal">
                <InputLabel>Status</InputLabel>
                <Select
                  value={completeForm.status}
                  onChange={(e) =>
                    setCompleteForm((prev) => ({
                      ...prev,
                      status: e.target.value as "success" | "failed",
                    }))
                  }
                >
                  <MenuItem value="success">Success</MenuItem>
                  <MenuItem value="failed">Failed</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth
                label="Generated Content"
                value={completeForm.content}
                onChange={(e) =>
                  setCompleteForm((prev) => ({
                    ...prev,
                    content: e.target.value,
                  }))
                }
                margin="normal"
                multiline
                rows={4}
              />
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                Token Usage
              </Typography>
              <TextField
                fullWidth
                label="Prompt Tokens"
                type="number"
                value={completeForm.usage?.promptTokens}
                onChange={(e) =>
                  setCompleteForm((prev) => ({
                    ...prev,
                    usage: {
                      ...prev.usage!,
                      promptTokens: parseInt(e.target.value),
                    },
                  }))
                }
                margin="normal"
                inputProps={{ min: 0 }}
              />
              <TextField
                fullWidth
                label="Completion Tokens"
                type="number"
                value={completeForm.usage?.completionTokens}
                onChange={(e) =>
                  setCompleteForm((prev) => ({
                    ...prev,
                    usage: {
                      ...prev.usage!,
                      completionTokens: parseInt(e.target.value),
                    },
                  }))
                }
                margin="normal"
                inputProps={{ min: 0 }}
              />
            </FormSection>

            <Button
              variant="contained"
              onClick={triggerComplete}
              disabled={
                loading.complete ||
                !completeForm.requestId ||
                !completeForm.organizationId
              }
              fullWidth
            >
              {loading.complete && (
                <CircularProgress size={20} sx={{ mr: 1 }} />
              )}
              Trigger Complete
            </Button>

            {errors.complete && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {errors.complete}
              </Alert>
            )}

            {results.complete && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2">Response:</Typography>
                <pre style={{ fontSize: "12px", overflow: "auto" }}>
                  {JSON.stringify(results.complete, null, 2)}
                </pre>
              </Box>
            )}
          </StyledPaper>
        </Grid>

        {/* Simulate Flow */}
        <Grid xs={12} md={6}>
          <StyledPaper>
            <Typography variant="h6" gutterBottom>
              Simulate Complete Flow
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Automatically triggers request → progress → complete sequence
            </Typography>

            <FormSection>
              <TextField
                fullWidth
                label="Organization ID"
                value={simulationForm.organizationId}
                onChange={(e) =>
                  setSimulationForm((prev) => ({
                    ...prev,
                    organizationId: e.target.value,
                  }))
                }
                margin="normal"
                required
              />
              <TextField
                fullWidth
                label="Project ID"
                value={simulationForm.projectId}
                onChange={(e) =>
                  setSimulationForm((prev) => ({
                    ...prev,
                    projectId: e.target.value,
                  }))
                }
                margin="normal"
                required
              />
              <TextField
                fullWidth
                label="Prompt"
                value={simulationForm.prompt}
                onChange={(e) =>
                  setSimulationForm((prev) => ({
                    ...prev,
                    prompt: e.target.value,
                  }))
                }
                margin="normal"
                multiline
                rows={3}
                required
              />
              <TextField
                fullWidth
                label="Simulation Delay (ms)"
                type="number"
                value={simulationForm.simulateDelay}
                onChange={(e) =>
                  setSimulationForm((prev) => ({
                    ...prev,
                    simulateDelay: parseInt(e.target.value),
                  }))
                }
                margin="normal"
                inputProps={{ min: 1000, max: 10000 }}
                helperText="Time before completion event is triggered"
              />
            </FormSection>

            <Button
              variant="contained"
              color="secondary"
              onClick={simulateFlow}
              disabled={
                loading.simulation ||
                !simulationForm.organizationId ||
                !simulationForm.projectId ||
                !simulationForm.prompt
              }
              fullWidth
            >
              {loading.simulation && (
                <CircularProgress size={20} sx={{ mr: 1 }} />
              )}
              Simulate Complete Flow
            </Button>

            {errors.simulation && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {errors.simulation}
              </Alert>
            )}

            {results.simulation && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2">Response:</Typography>
                <pre style={{ fontSize: "12px", overflow: "auto" }}>
                  {JSON.stringify(results.simulation, null, 2)}
                </pre>
              </Box>
            )}
          </StyledPaper>
        </Grid>
      </Grid>
    </Box>
  );
}
