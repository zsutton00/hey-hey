import {
  entityContextClient,
  unifiedApiClient,
} from "@hey-hey/ui-common/clients";
import { EntityType } from "@hey-hey/ui-common/api";
import { useProjectCapabilities } from "@hey-hey/ui-common/hooks";
import { OutboxEvents } from "@hey-hey/ui-common/components";
import {
  Alert,
  Box,
  ButtonGroup,
  Button,
  CircularProgress,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useState } from "react";
import { EntityRelationshipsTab } from "./EntityRelationshipsTab";
import { DebugEventReplayPanel } from "./DebugEventReplayPanel";
import { TabContainer } from "./TabContainer";

type DebugSection =
  | "context"
  | "relationships"
  | "outbox"
  | "embeddings"
  | "replay";

export interface DataDebugTabProps {
  organizationId: string;
  projectId: string;
  entityId: string;
  entityType: string;
  featureId?: string;
  renderOutbox?: () => React.ReactNode;
}

const preStyles = {
  p: 2,
  bgcolor: "grey.900",
  color: "grey.100",
  borderRadius: 1,
  overflow: "auto",
  fontSize: "0.75rem",
  maxHeight: 600,
  fontFamily: "monospace",
} as const;

const JsonPreBlock: React.FC<{
  data: unknown;
  isLoading: boolean;
  error: string | null;
}> = ({ data, isLoading, error }) => {
  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Box component="pre" sx={preStyles}>
      {JSON.stringify(data, null, 2)}
    </Box>
  );
};

const contextEntityTypeByDebugType: Record<string, EntityType> = {
  agent_session: EntityType.AgentSession,
  "agent-session": EntityType.AgentSession,
  conversation: EntityType.Conversation,
  design_doc: EntityType.DesignDoc,
  "design-doc": EntityType.DesignDoc,
  initiative: EntityType.Initiative,
  message: EntityType.Message,
  plan: EntityType.Task,
  project: EntityType.Project,
  report: EntityType.Report,
  service: EntityType.Service,
  task: EntityType.Task,
};

const ContextSection: React.FC<{
  organizationId: string;
  projectId: string;
  entityId: string;
  entityType: string;
}> = ({ organizationId, projectId, entityId, entityType }) => {
  const [data, setData] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchContext = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const contextEntityType =
          contextEntityTypeByDebugType[entityType.toLowerCase()];
        if (!contextEntityType) {
          throw new Error(`Unsupported entity type: ${entityType}`);
        }
        const response = await entityContextClient.getEntityContext({
          organizationId,
          projectId,
          entityType: contextEntityType,
          entityId,
        });
        if (!cancelled) {
          setData(response.data);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to load context";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchContext();

    return () => {
      cancelled = true;
    };
  }, [organizationId, projectId, entityId, entityType]);

  return <JsonPreBlock data={data} isLoading={isLoading} error={error} />;
};

const EmbeddingsSection: React.FC<{
  projectId: string;
  entityId: string;
  entityType: string;
}> = ({ projectId, entityId, entityType }) => {
  const [data, setData] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchEmbeddings = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await unifiedApiClient.getDebugEmbeddingsEntity({
          type: entityType,
          id: entityId,
          projectId,
        });
        if (!cancelled) {
          setData(response.data);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to load embeddings";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchEmbeddings();

    return () => {
      cancelled = true;
    };
  }, [projectId, entityId, entityType]);

  return <JsonPreBlock data={data} isLoading={isLoading} error={error} />;
};

export const DataDebugTab: React.FC<DataDebugTabProps> = ({
  organizationId,
  projectId,
  entityId,
  entityType,
  renderOutbox,
}) => {
  const [section, setSection] = useState<DebugSection>("context");
  const { viewProjectEmbeddings } = useProjectCapabilities(
    organizationId,
    projectId,
  );

  const handleSectionChange = useCallback((next: DebugSection) => {
    setSection(next);
  }, []);

  const sections: { value: DebugSection; label: string }[] = [
    { value: "context", label: "Context" },
    { value: "relationships", label: "Relationships" },
    { value: "outbox", label: "Outbox Events" },
    ...(viewProjectEmbeddings
      ? [{ value: "embeddings" as const, label: "Embeddings" }]
      : []),
    { value: "replay", label: "Replay" },
  ];

  return (
    <TabContainer>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Data Debug
        </Typography>
        <ButtonGroup size="small">
          {sections.map((s) => (
            <Button
              key={s.value}
              variant={section === s.value ? "contained" : "outlined"}
              onClick={() => handleSectionChange(s.value)}
            >
              {s.label}
            </Button>
          ))}
        </ButtonGroup>
      </Box>

      <Box sx={{ mt: 2 }}>
        {section === "context" && (
          <ContextSection
            organizationId={organizationId}
            projectId={projectId}
            entityId={entityId}
            entityType={entityType}
          />
        )}

        {section === "relationships" && (
          <EntityRelationshipsTab
            organizationId={organizationId}
            projectId={projectId}
            entityId={entityId}
          />
        )}

        {section === "outbox" &&
          (renderOutbox ? (
            renderOutbox()
          ) : (
            <OutboxEvents entityId={entityId} entityType={entityType} />
          ))}

        {section === "embeddings" && viewProjectEmbeddings && (
          <EmbeddingsSection
            projectId={projectId}
            entityId={entityId}
            entityType={entityType}
          />
        )}

        {section === "replay" && (
          <DebugEventReplayPanel
            entityId={entityId}
            entityType={entityType}
            projectId={projectId}
          />
        )}
      </Box>
    </TabContainer>
  );
};
