import React, { useMemo, useState } from "react";
import { Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AgentSessionType } from "@hey-hey/ui-common/api";
import { useAgentSessions } from "@hey-hey/ui-common/data";

const PAGE_SIZE = 20;

export interface FeatureConversationsTabProps {
  organizationId: string;
  projectId: string;
}

export const FeatureConversationsTab: React.FC<FeatureConversationsTabProps> = ({
  organizationId,
  projectId,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { agentSessions, isLoading, isReady } = useAgentSessions(
    organizationId,
    projectId,
    { type: AgentSessionType.ProjectConversation },
  );

  const sorted = useMemo(() => {
    const sessions = agentSessions ?? [];
    return [...sessions].sort((a, b) => {
      const aTime = new Date(a.createdAt ?? a.sessionDate).getTime();
      const bTime = new Date(b.createdAt ?? b.sessionDate).getTime();
      return bTime - aTime;
    });
  }, [agentSessions]);

  const limit = page * PAGE_SIZE;
  const visible = sorted.slice(0, limit);
  const canLoadMore = sorted.length > limit;

  if (isLoading) {
    return (
      <Box
        sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: 6 }}
        data-testid="feature-conversations-loading"
      >
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (isReady && sorted.length === 0) {
    return (
      <Box
        sx={{ py: 6, textAlign: "center" }}
        data-testid="feature-conversations-empty"
      >
        <Typography variant="body1" color="text.secondary">
          {t(
            "features.conversations.empty",
            "No conversations yet — click Discuss to start a feature tree conversation.",
          )}
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2} data-testid="feature-conversations-list">
      {visible.map((session) => {
        const href = `/projects/${projectId}/agent-sessions/${session.id}`;
        const timestamp = session.createdAt ?? session.sessionDate;
        return (
          <Box
            key={session.id}
            component="a"
            href={href}
            onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
              if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                navigate(href);
              }
            }}
            data-testid={`feature-conversation-${session.id}`}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              p: 2,
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              textDecoration: "none",
              color: "inherit",
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Typography variant="body1" fontWeight={500}>
              {session.title ||
                t("features.conversations.untitledSession", "Conversation")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ ml: 2, flexShrink: 0 }}>
              {new Date(timestamp).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </Typography>
          </Box>
        );
      })}
      {canLoadMore && (
        <Box sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
          <Button
            variant="outlined"
            onClick={() => setPage((prev) => prev + 1)}
            data-testid="feature-conversations-load-more"
          >
            {t("features.conversations.loadMore", "Load more")}
          </Button>
        </Box>
      )}
    </Stack>
  );
};
