import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  useEntityPromptTemplates,
  useProposals,
} from "@hey-hey/ui-common/data";
import {
  TargetEntityType,
  type EntityPromptTemplateCatalogEntryDto,
  type ProposalResponseDto,
} from "@hey-hey/ui-common/api";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { EntityPromptTemplateCompositionGuidance } from "./EntityPromptTemplateCompositionGuidance";
import { EntityPromptTemplateOverrideEditor } from "./EntityPromptTemplateOverrideEditor";
import type { EntityPromptTemplatePendingOperation } from "./EntityPromptTemplateProposalActions";
import { EntityPromptTemplatePublicationActions } from "./EntityPromptTemplatePublicationActions";

export interface EntityPromptTemplatesPanelProps {
  organizationId: string | undefined;
  projectId: string | undefined;
}

const formatTemplateLabel = (templateKey: string): string =>
  templateKey
    .split(/[._-]/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const formatScopeLabel = (scope: "CANONICAL" | "PROJECT"): string =>
  scope === "PROJECT" ? "Project override" : "Canonical default";

interface TemplateCardOptions {
  organizationId: string;
  projectId: string;
  template: EntityPromptTemplateCatalogEntryDto;
}

const EntityPromptTemplateCard: React.FC<TemplateCardOptions> = ({
  organizationId,
  projectId,
  template,
}) => {
  const [rejectedContent, setRejectedContent] = useState<string>();
  const [createdProposals, setCreatedProposals] = useState<
    ProposalResponseDto[]
  >([]);
  const [pendingOperations, setPendingOperations] = useState<
    Record<string, EntityPromptTemplatePendingOperation>
  >({});
  const proposalsQuery = useProposals(organizationId, projectId, {
    targetEntityType: TargetEntityType.EntityPromptTemplate,
    targetEntityId: template.templateKey,
  });
  const proposals = useMemo(() => {
    const byId = new Map<string, ProposalResponseDto>();
    for (const proposal of createdProposals) {
      byId.set(proposal.id, proposal);
    }
    // The query is the authoritative projection once it contains a created
    // proposal, so a later approval or rejection can replace the local result.
    for (const proposal of proposalsQuery.data ?? []) {
      byId.set(proposal.id, proposal);
    }
    return [...byId.values()];
  }, [createdProposals, proposalsQuery.data]);
  const handleProposalCreated = useCallback((proposal: ProposalResponseDto) => {
    setCreatedProposals((current) => {
      const existingIndex = current.findIndex(
        (existing) => existing.id === proposal.id
      );
      if (existingIndex < 0) {
        return [...current, proposal];
      }
      const next = [...current];
      next[existingIndex] = proposal;
      return next;
    });
  }, []);
  const handlePendingOperationChange = useCallback(
    (
      proposalId: string,
      operation: EntityPromptTemplatePendingOperation | null
    ): void => {
      setPendingOperations((current) => {
        if (operation === null) {
          if (!(proposalId in current)) {
            return current;
          }
          const next = { ...current };
          delete next[proposalId];
          return next;
        }
        return current[proposalId] === operation
          ? current
          : { ...current, [proposalId]: operation };
      });
    },
    []
  );
  const hasPendingChange = Object.values(pendingOperations).includes("UPSERT");
  const hasPendingRetirement =
    Object.values(pendingOperations).includes("RETIRE");

  useEffect(() => {
    setRejectedContent(undefined);
  }, [template.effective.revisionId]);

  return (
    <Paper
      component="article"
      variant="outlined"
      data-testid="entity-prompt-template-card"
      data-template-key={template.templateKey}
      sx={{ p: 3 }}
    >
      <Stack spacing={3}>
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          justifyContent="space-between"
          data-testid="entity-prompt-template-heading"
        >
          <Typography component="h2" variant="h6">
            {formatTemplateLabel(template.templateKey)}
          </Typography>
          <EntityPromptTemplateCompositionGuidance
            effective={template.effective}
          />
        </Stack>

        <EntityPromptTemplateOverrideEditor
          organizationId={organizationId}
          projectId={projectId}
          template={template}
          selector={template.effective.selector}
          syntaxVersion={template.effective.syntaxVersion}
          rejectedContent={rejectedContent}
          disabled={hasPendingChange || hasPendingRetirement}
          proposals={proposals}
          proposalsError={proposalsQuery.error}
          onReviseRejected={setRejectedContent}
          onPendingOperationChange={handlePendingOperationChange}
          onProposalCreated={handleProposalCreated}
        />

        <EntityPromptTemplatePublicationActions
          organizationId={organizationId}
          projectId={projectId}
          template={template}
          selector={template.effective.selector}
          disabled={hasPendingChange || hasPendingRetirement}
          onProposalCreated={handleProposalCreated}
        />
      </Stack>
    </Paper>
  );
};

/*
 * Keep the card as a component because publication transitions can replace
 * the effective projection immediately while the catalog/history query is
 * being refreshed.
 */
const renderTemplateCard = ({
  organizationId,
  projectId,
  template,
}: TemplateCardOptions): React.ReactNode => (
  <EntityPromptTemplateCard
    key={template.templateKey}
    organizationId={organizationId}
    projectId={projectId}
    template={template}
  />
);

interface PanelQuery {
  templates: EntityPromptTemplateCatalogEntryDto[];
  isLoading: boolean;
  isReady: boolean;
  isFetched?: boolean;
  error: Error | null;
}

interface PanelContentOptions {
  organizationId: string | undefined;
  projectId: string | undefined;
  query: PanelQuery;
  selectedTemplateKey: string | null;
  onSelectTemplate: (templateKey: string) => void;
  onBack: () => void;
}

const renderPanelContent = ({
  organizationId,
  projectId,
  query,
  selectedTemplateKey,
  onSelectTemplate,
  onBack,
}: PanelContentOptions): React.ReactNode => {
  if (!organizationId || !projectId) {
    return (
      <Alert
        severity="warning"
        data-testid="entity-prompt-templates-missing-scope"
      >
        Entity prompt templates require an organization and project scope.
      </Alert>
    );
  }

  if (query.isLoading || (!query.isReady && !query.isFetched && !query.error)) {
    return (
      <Box
        data-testid="entity-prompt-templates-loading"
        role="status"
        sx={{ display: "flex", justifyContent: "center", p: 4 }}
      >
        <CircularProgress aria-label="Loading entity prompt templates" />
      </Box>
    );
  }

  if (query.error) {
    return (
      <Alert severity="error" data-testid="entity-prompt-templates-error">
        Failed to load entity prompt templates: {query.error.message}
      </Alert>
    );
  }

  if (query.isReady && query.templates.length === 0) {
    return (
      <Alert severity="info" data-testid="entity-prompt-templates-empty">
        No supported entity prompt templates are available for this project.
      </Alert>
    );
  }

  const selectedTemplate = query.templates.find(
    (template) => template.templateKey === selectedTemplateKey
  );

  if (selectedTemplate) {
    return (
      <Stack spacing={2} data-testid="entity-prompt-template-detail">
        <Box>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={onBack}
            data-testid="entity-prompt-template-back"
          >
            Back to template types
          </Button>
        </Box>
        {renderTemplateCard({
          organizationId,
          projectId,
          template: selectedTemplate,
        })}
      </Stack>
    );
  }

  return (
    <Paper variant="outlined" data-testid="entity-prompt-templates-list">
      <List disablePadding aria-label="Entity prompt template types">
        {query.templates.map((template, index) => (
          <React.Fragment key={template.templateKey}>
            {index > 0 && <Divider />}
            <ListItemButton
              onClick={() => onSelectTemplate(template.templateKey)}
              data-testid="entity-prompt-template-list-item"
            >
              <ListItemText
                primary={formatTemplateLabel(template.templateKey)}
                secondary={`Effective revision ${
                  template.effective.revisionNumber
                } · ${formatScopeLabel(
                  template.effective.ownershipSource.scope
                )}`}
              />
            </ListItemButton>
          </React.Fragment>
        ))}
      </List>
    </Paper>
  );
};

export const EntityPromptTemplatesPanel: React.FC<
  EntityPromptTemplatesPanelProps
> = ({ organizationId, projectId }) => {
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(
    null
  );
  const query = useEntityPromptTemplates(
    organizationId && projectId ? { organizationId, projectId } : undefined
  );
  const panelQuery: PanelQuery = {
    templates: query.catalog?.templates ?? [],
    isLoading: query.isLoading,
    isReady: query.isReady,
    isFetched: query.isFetched,
    error: query.error,
  };

  return (
    <Box data-testid="entity-prompt-templates-panel">
      <Stack spacing={2}>
        <Box>
          <Typography component="h2" variant="h5">
            Entity Prompt Templates
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Propose project-specific changes through standard review while
            keeping the API-selected effective template and provenance visible.
          </Typography>
        </Box>
        {renderPanelContent({
          organizationId,
          projectId,
          query: panelQuery,
          selectedTemplateKey,
          onSelectTemplate: setSelectedTemplateKey,
          onBack: () => setSelectedTemplateKey(null),
        })}
      </Stack>
    </Box>
  );
};

EntityPromptTemplatesPanel.displayName = "EntityPromptTemplatesPanel";
