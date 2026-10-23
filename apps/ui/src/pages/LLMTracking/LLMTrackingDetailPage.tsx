import type { LLMPromptResponseDto } from "@hey-hey/ui-common/api";
import { apiClient } from "@hey-hey/ui-common/clients";
import { KEYS } from "@hey-hey/ui-common/i18n";
import BackIcon from "@mui/icons-material/ArrowBack";
import CheckIcon from "@mui/icons-material/Check";
import CopyIcon from "@mui/icons-material/ContentCopy";
import ErrorIcon from "@mui/icons-material/Error";
import SuccessIcon from "@mui/icons-material/CheckCircle";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

export const LLMTrackingDetailPage: React.FC = (): React.ReactElement => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [record, setRecord] = useState<LLMPromptResponseDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);

  useEffect(() => {
    const fetchRecord = async (): Promise<void> => {
      if (!id) return;

      try {
        setLoading(true);
        setError(null);

        const response = await apiClient.getLlmTrackingRecord({ id });
        if (response.data.data) {
          setRecord(response.data.data);
        }
      } catch (err: unknown) {
        const error = err as {
          message?: string;
          response?: { data?: { message?: string } };
        };
        console.error("Failed to fetch LLM tracking record:", error);
        setError(
          error.response?.data?.message ||
            error.message ||
            "Failed to load LLM tracking record",
        );
      } finally {
        setLoading(false);
      }
    };

    void fetchRecord();
  }, [id]);

  const handleBack = (): void => {
    navigate("/llm-tracking");
  };

  const formatDuration = (ms: number | null | undefined): string => {
    if (!ms) return t(KEYS.common.unknown);
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatDate = (dateString: string | undefined): string => {
    if (!dateString) return t(KEYS.common.unknown);
    return new Date(dateString).toLocaleString();
  };

  const formatCost = (cost: number | null | undefined): string => {
    if (cost === null || cost === undefined) return t(KEYS.common.unknown);
    return cost.toLocaleString(undefined, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 6,
    });
  };

  const handleCopyPrompt = async (): Promise<void> => {
    if (!record?.prompt) return;
    try {
      await navigator.clipboard.writeText(record.prompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch (err) {
      console.error("Failed to copy prompt:", err);
    }
  };

  const handleCopyResponse = async (): Promise<void> => {
    if (!record?.responseContent) return;
    try {
      await navigator.clipboard.writeText(record.responseContent);
      setCopiedResponse(true);
      setTimeout(() => setCopiedResponse(false), 2000);
    } catch (err) {
      console.error("Failed to copy response:", err);
    }
  };

  const prettifyJson = (content: string): string => {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 4);
    } catch {
      return content;
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !record) {
    return (
      <Box sx={{ p: 3 }}>
        <Button startIcon={<BackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
          {t(KEYS.common.back)}
        </Button>
        <Alert severity="error">{error || "Record not found"}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Button startIcon={<BackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
          {t(KEYS.common.back)}
        </Button>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
          {record.success ? (
            <SuccessIcon color="success" />
          ) : (
            <ErrorIcon color="error" />
          )}
          <Typography variant="h4">
            {t(KEYS.llmTracking.details.title)}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Chip label={record.provider} />
          <Chip label={record.model} variant="outlined" />
          {record.success ? (
            <Chip
              label={t(KEYS.llmTracking.filters.successful)}
              color="success"
            />
          ) : (
            <Chip label={t(KEYS.llmTracking.filters.failed)} color="error" />
          )}
        </Box>
      </Box>

      <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
        {/* Metadata */}
        <Box sx={{ flex: { xs: "1 1 100%", md: "0 0 calc(33.333% - 16px)" } }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {t(KEYS.llmTracking.details.metadata)}
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t(KEYS.llmTracking.metadata.createdAt)}
                  </Typography>
                  <Typography variant="body2">
                    {formatDate(record.createdAt)}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t(KEYS.llmTracking.metadata.duration)}
                  </Typography>
                  <Typography variant="body2">
                    {formatDuration(record.durationMs)}
                  </Typography>
                </Box>

                {record.temperature !== null &&
                  record.temperature !== undefined && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        {t(KEYS.llmTracking.metadata.temperature)}
                      </Typography>
                      <Typography variant="body2">
                        {record.temperature}
                      </Typography>
                    </Box>
                  )}

                {record.maxTokens && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t(KEYS.llmTracking.metadata.maxTokens)}
                    </Typography>
                    <Typography variant="body2">{record.maxTokens}</Typography>
                  </Box>
                )}

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t(KEYS.llmTracking.metadata.stream)}
                  </Typography>
                  <Typography variant="body2">
                    {record.stream ? t(KEYS.common.yes) : t(KEYS.common.no)}
                  </Typography>
                </Box>

                {record.projectId && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t(KEYS.llmTracking.metadata.projectId)}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                        wordBreak: "break-all",
                      }}
                    >
                      {record.projectId}
                    </Typography>
                  </Box>
                )}

                {record.conversationId && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t(KEYS.llmTracking.metadata.conversationId)}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                        wordBreak: "break-all",
                      }}
                    >
                      {record.conversationId}
                    </Typography>
                  </Box>
                )}

                {record.workflowId && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t(KEYS.llmTracking.metadata.workflowId)}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                        wordBreak: "break-all",
                      }}
                    >
                      {record.workflowId}
                    </Typography>
                  </Box>
                )}

                {record.nodeId && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t(KEYS.llmTracking.metadata.nodeId)}
                    </Typography>
                    <Typography variant="body2">{record.nodeId}</Typography>
                  </Box>
                )}

                {record.nodeType && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t(KEYS.llmTracking.metadata.nodeType)}
                    </Typography>
                    <Typography variant="body2">{record.nodeType}</Typography>
                  </Box>
                )}

                {!record.success && record.errorMessage && (
                  <Box>
                    <Typography variant="caption" color="error">
                      {t(KEYS.llmTracking.metadata.error)}
                    </Typography>
                    <Typography variant="body2" color="error">
                      {record.errorMessage}
                    </Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>

          {/* Token Usage */}
          {(record.promptTokens ||
            record.completionTokens ||
            record.totalTokens) && (
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {t(KEYS.llmTracking.details.usage)}
                </Typography>
                <Divider sx={{ mb: 2 }} />

                <Box
                  sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}
                >
                  {record.promptTokens !== null &&
                    record.promptTokens !== undefined && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {t(KEYS.llmTracking.usage.promptTokens)}
                        </Typography>
                        <Typography variant="body2">
                          {record.promptTokens.toLocaleString()}
                        </Typography>
                      </Box>
                    )}

                  {record.completionTokens !== null &&
                    record.completionTokens !== undefined && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {t(KEYS.llmTracking.usage.completionTokens)}
                        </Typography>
                        <Typography variant="body2">
                          {record.completionTokens.toLocaleString()}
                        </Typography>
                      </Box>
                    )}

                  {record.totalTokens !== null &&
                    record.totalTokens !== undefined && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {t(KEYS.llmTracking.usage.totalTokens)}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {record.totalTokens.toLocaleString()}
                        </Typography>
                      </Box>
                    )}
                </Box>
              </CardContent>
            </Card>
          )}

          {(record.inputCost !== null && record.inputCost !== undefined) ||
          (record.outputCost !== null && record.outputCost !== undefined) ||
          (record.totalCost !== null && record.totalCost !== undefined) ? (
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Cost
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <Box
                  sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}
                >
                  {record.inputCost !== null &&
                    record.inputCost !== undefined && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Input Cost
                        </Typography>
                        <Typography variant="body2">
                          ${formatCost(record.inputCost)}
                        </Typography>
                      </Box>
                    )}

                  {record.outputCost !== null &&
                    record.outputCost !== undefined && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Output Cost
                        </Typography>
                        <Typography variant="body2">
                          ${formatCost(record.outputCost)}
                        </Typography>
                      </Box>
                    )}

                  {record.totalCost !== null &&
                    record.totalCost !== undefined && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Total Cost
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          ${formatCost(record.totalCost)}
                        </Typography>
                      </Box>
                    )}
                </Box>
              </CardContent>
            </Card>
          ) : null}
        </Box>

        {/* Prompt and Response */}
        <Box sx={{ flex: { xs: "1 1 100%", md: "1 1 calc(66.666% - 16px)" } }}>
          {/* Prompt */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                mb: 1,
              }}
            >
              <Typography variant="h6">
                {t(KEYS.llmTracking.details.prompt)}
              </Typography>
              <Tooltip title={copiedPrompt ? "Copied!" : "Copy prompt"}>
                <IconButton
                  onClick={handleCopyPrompt}
                  size="small"
                  color={copiedPrompt ? "success" : "default"}
                >
                  {copiedPrompt ? (
                    <CheckIcon fontSize="small" />
                  ) : (
                    <CopyIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </Box>
            <Divider sx={{ mb: 2 }} />
            <Typography
              component="pre"
              sx={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "monospace",
                fontSize: "0.875rem",
                backgroundColor: "rgba(0, 0, 0, 0.03)",
                p: 2,
                borderRadius: 1,
                maxHeight: "400px",
                overflow: "auto",
              }}
            >
              {record.prompt}
            </Typography>
          </Paper>

          {/* Response */}
          <Paper sx={{ p: 3 }}>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                mb: 1,
              }}
            >
              <Typography variant="h6">
                {t(KEYS.llmTracking.details.response)}
              </Typography>
              <Tooltip title={copiedResponse ? "Copied!" : "Copy response"}>
                <IconButton
                  onClick={handleCopyResponse}
                  size="small"
                  color={copiedResponse ? "success" : "default"}
                >
                  {copiedResponse ? (
                    <CheckIcon fontSize="small" />
                  ) : (
                    <CopyIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </Box>
            <Divider sx={{ mb: 2 }} />
            <Box
              sx={{
                backgroundColor: "rgba(0, 0, 0, 0.03)",
                p: 2,
                borderRadius: 1,
                maxHeight: "600px",
                overflow: "auto",
                whiteSpace: "pre-wrap",
                "& p": {
                  marginTop: 0,
                  marginBottom: "1em",
                  "&:last-child": {
                    marginBottom: 0,
                  },
                },
                "& h1, & h2, & h3, & h4, & h5, & h6": {
                  marginTop: "0.5em",
                  marginBottom: "0.5em",
                },
                "& ul, & ol": {
                  marginTop: "0.5em",
                  marginBottom: "0.5em",
                  paddingLeft: "2em",
                },
                "& code": {
                  backgroundColor: "rgba(0, 0, 0, 0.05)",
                  padding: "0.2em 0.4em",
                  borderRadius: "3px",
                  fontFamily: "monospace",
                  fontSize: "0.875em",
                },
                "& pre": {
                  backgroundColor: "rgba(0, 0, 0, 0.05)",
                  padding: "1em",
                  borderRadius: "3px",
                  overflow: "auto",
                  "& code": {
                    backgroundColor: "transparent",
                    padding: 0,
                  },
                },
              }}
            >
              {record.responseContent
                ? prettifyJson(record.responseContent)
                : ""}
            </Box>
          </Paper>
        </Box>
      </Box>
    </Box>
  );
};
