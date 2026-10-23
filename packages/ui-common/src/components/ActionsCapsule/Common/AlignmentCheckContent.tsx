import React, { useCallback, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import SyncIcon from "@mui/icons-material/Sync";
import {
  AgentSessionType,
  EntityType,
  type AgentSessionDto,
} from "../../../api";
import { useCreateAgentSession } from "../../../data/hooks/useCreateAgentSession";

export interface AlignmentCheckContentProps {
  organizationId: string;
  projectId: string;
  designDocIds: string[];
  inferredServiceId?: string;
  previousSession?: AgentSessionDto | null;
  onSessionCreated?: (session: AgentSessionDto) => void;
  buildSessionPath?: (sessionId: string) => string;
}

export const AlignmentCheckContent: React.FC<AlignmentCheckContentProps> = ({
  organizationId,
  projectId,
  designDocIds,
  inferredServiceId,
  previousSession,
  onSessionCreated,
  buildSessionPath,
}) => {
  const [error, setError] = useState<string | null>(null);

  const { mutate: createSession, isPending: creating } = useCreateAgentSession({
    onSuccess: (session: AgentSessionDto) => {
      onSessionCreated?.(session);
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to start alignment check session");
    },
  });

  const handleCheckAlignment = useCallback(() => {
    if (!organizationId || designDocIds.length === 0) return;

    setError(null);

    const primaryDesignDocId = designDocIds[0];

    createSession({
      organizationId,
      agentSession: {
        projectId,
        sessionDate: new Date().toISOString(),
        title: "Design Doc Alignment Check",
        entityType: EntityType.DesignDoc,
        entityId: primaryDesignDocId,
        launchServiceId: inferredServiceId,
        serviceIds: inferredServiceId ? [inferredServiceId] : [],
        type: AgentSessionType.Coding,
      },
    });
  }, [
    organizationId,
    projectId,
    designDocIds,
    inferredServiceId,
    createSession,
  ]);

  const isLoading = creating;

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Compare design document(s) against the current implementation to surface
        discrepancies, missing features, or required updates. This starts a
        coding agent conversation that analyzes your code against the documented
        design.
      </Typography>

      {error && (
        <Alert severity="error" variant="outlined">
          <Typography variant="body2">{error}</Typography>
        </Alert>
      )}

      {previousSession && buildSessionPath && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            Previous alignment check:
          </Typography>
          <Link
            href={buildSessionPath(previousSession.id)}
            underline="hover"
            variant="body2"
            sx={{ display: "block" }}
          >
            {previousSession.title ?? "View previous session"}
          </Link>
        </Box>
      )}

      <Button
        variant="outlined"
        size="small"
        startIcon={isLoading ? <CircularProgress size={16} /> : <SyncIcon />}
        onClick={handleCheckAlignment}
        disabled={isLoading || designDocIds.length === 0}
      >
        {creating ? "Starting…" : "Check Alignment"}
      </Button>
    </Stack>
  );
};
