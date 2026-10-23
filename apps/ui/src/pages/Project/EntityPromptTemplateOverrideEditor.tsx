import { EntityPromptTemplateEditor } from "@hey-hey/ui-common/components";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  getEntityPromptTemplateCompositionMetadata,
  useCreateEntityPromptTemplateChangeProposal,
  useEntityPromptTemplateDraftValidation,
} from "@hey-hey/ui-common/data";
import type {
  EntityPromptTemplateCatalogEntryDto,
  EntityPromptTemplatePublishedCanonicalRevisionDto,
  EntityPromptTemplateSelectorDto,
  EntityPromptTemplateSyntaxVersion,
  ProposalResponseDto,
} from "@hey-hey/ui-common/api";
import React, { useEffect, useRef, useState } from "react";
import { CardHeader } from "../../components/CardHeader";
import {
  EntityPromptTemplateProposalActions,
  type EntityPromptTemplatePendingOperation,
} from "./EntityPromptTemplateProposalActions";

export interface EntityPromptTemplateOverrideEditorProps {
  disabled?: boolean;
  organizationId: string;
  projectId: string;
  template: EntityPromptTemplateCatalogEntryDto;
  rejectedContent?: string;
  selector: EntityPromptTemplateSelectorDto;
  syntaxVersion: EntityPromptTemplateSyntaxVersion;
  proposals: ProposalResponseDto[];
  proposalsError: Error | null;
  onReviseRejected: (content: string) => void;
  onPendingOperationChange: (
    proposalId: string,
    operation: EntityPromptTemplatePendingOperation | null
  ) => void;
  onProposalCreated?: (proposal: ProposalResponseDto) => void;
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message.length > 0
    ? error.message
    : "The proposal could not be created. Please try again.";

const formatScopeLabel = (scope: "CANONICAL" | "PROJECT"): string =>
  scope === "PROJECT" ? "Project override" : "Canonical default";

const formatLifecycleLabel = (state: string): string =>
  state.charAt(0) + state.slice(1).toLowerCase();

const renderTemplateLanguageHelp = (
  metadata: ReturnType<typeof getEntityPromptTemplateCompositionMetadata>
): React.ReactNode => (
  <Paper
    data-testid="entity-prompt-template-language-help"
    sx={{
      flex: 1,
      minWidth: 0,
      p: 2,
    }}
    component="aside"
    variant="outlined"
  >
    <CardHeader title="Supported Fields" />
    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
      <Box>
        <Typography variant="body2" fontWeight="fontWeightMedium">
          Supported template fields
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 3, overflowWrap: "anywhere" }}>
          {metadata.templateLanguage.supportedPaths.map((path) => (
            <Typography component="li" variant="body2" key={path}>
              <Box component="code">{path}</Box>
            </Typography>
          ))}
        </Box>
      </Box>
      <Box>
        <Typography variant="body2" fontWeight="fontWeightMedium">
          Dynamic field families
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 3, overflowWrap: "anywhere" }}>
          {metadata.templateLanguage.authoring.pathFamilies.map((family) => (
            <Typography component="li" variant="body2" key={family.template}>
              <Box component="code">{family.template}</Box> — {family.description} Pattern{" "}
              <Box component="code">{family.pattern}</Box>
            </Typography>
          ))}
        </Box>
      </Box>
    </Stack>
  </Paper>
);

interface CurrentTemplateMetadataProps {
  template: EntityPromptTemplateCatalogEntryDto;
  selectorLabel: string;
}

const CurrentTemplateMetadata: React.FC<CurrentTemplateMetadataProps> = ({
  template,
  selectorLabel,
}) => {
  const effective = template.effective;

  return (
    <Box data-testid="entity-prompt-template-effective">
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        flexWrap="wrap"
        data-testid="entity-prompt-template-current-metadata"
      >
        <Chip
          size="small"
          variant="outlined"
          label={`Source: ${formatScopeLabel(effective.ownershipSource.scope)}`}
        />
        <Chip
          size="small"
          variant="outlined"
          label={`Revision ${effective.revisionNumber}`}
        />
        <Chip
          size="small"
          variant="outlined"
          label={formatLifecycleLabel(effective.lifecycleState)}
        />
        <Chip
          size="small"
          variant="outlined"
          label={`Validation: ${effective.validationStatus}`}
        />
        <Chip
          size="small"
          variant="outlined"
          label={`Selector: ${selectorLabel}`}
        />
        <Chip
          size="small"
          variant="outlined"
          label={`Syntax version: ${effective.syntaxVersion}`}
        />
      </Stack>
    </Box>
  );
};

const CurrentTemplateContent: React.FC<{ content: string }> = ({ content }) => (
  <Paper
    component="pre"
    variant="outlined"
    data-testid="entity-prompt-template-current-content"
    sx={{
      m: 0,
      p: 2,
      typography: "body2",
      overflowX: "auto",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      fontFamily: "inherit",
    }}
  >
    {content}
  </Paper>
);

interface StandardTemplatePresentationProps {
  canonicalDefault: EntityPromptTemplatePublishedCanonicalRevisionDto;
}

const StandardTemplatePresentation: React.FC<
  StandardTemplatePresentationProps
> = ({ canonicalDefault }) => (
  <Box data-testid="entity-prompt-template-standard">
    <Typography component="h3" variant="subtitle1">
      Hey Hey Standard
    </Typography>
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      flexWrap="wrap"
      sx={{ mt: 1 }}
    >
      <Chip
        size="small"
        variant="outlined"
        label={`Revision ${canonicalDefault.revisionNumber}`}
      />
      <Chip size="small" variant="outlined" label="Canonical default" />
      <Chip
        size="small"
        variant="outlined"
        label={formatLifecycleLabel(canonicalDefault.lifecycleState)}
      />
      <Chip size="small" variant="outlined" label="Read-only" />
    </Stack>
    <Paper
      component="pre"
      variant="outlined"
      data-testid="entity-prompt-template-standard-content"
      sx={{
        m: 0,
        mt: 1,
        p: 2,
        typography: "body2",
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        fontFamily: "inherit",
      }}
    >
      {canonicalDefault.content}
    </Paper>
  </Box>
);

export const EntityPromptTemplateOverrideEditor: React.FC<
  EntityPromptTemplateOverrideEditorProps
> = ({
  disabled = false,
  organizationId,
  projectId,
  template,
  rejectedContent,
  selector,
  syntaxVersion,
  proposals,
  proposalsError,
  onReviseRejected,
  onPendingOperationChange,
  onProposalCreated,
}) => {
  const [content, setContent] = useState(
    rejectedContent ?? template.effective.content
  );
  const [eli5, setEli5] = useState("");
  const [isEditing, setIsEditing] = useState(rejectedContent !== undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submissionLock = useRef(false);
  const createProposal = useCreateEntityPromptTemplateChangeProposal();
  const compositionMetadata = getEntityPromptTemplateCompositionMetadata(
    template.effective
  );

  const validation = useEntityPromptTemplateDraftValidation(
    { organizationId, projectId, templateKey: template.templateKey },
    isEditing ? { selector, syntaxVersion, content } : null,
  );
  const canSave = eli5.trim().length > 0 && validation.status === "valid" &&
    validation.source.content === content && validation.source.syntaxVersion === syntaxVersion;

  useEffect(() => {
    setContent(template.effective.content);
    setEli5("");
    setIsEditing(false);
    setSuccessMessage(null);
    setError(null);
  }, [template.effective.content, template.effective.revisionId]);

  useEffect(() => {
    if (rejectedContent === undefined) {
      return;
    }

    setContent(rejectedContent);
    setIsEditing(true);
    setSuccessMessage(null);
    setError(null);
  }, [rejectedContent]);

  const handleContentChange = (
    content: string
  ): void => {
    setContent(content);
    setSuccessMessage(null);
    setError(null);
  };

  const handleEdit = (): void => {
    if (disabled) {
      return;
    }
    setContent(template.effective.content);
    setEli5("");
    setSuccessMessage(null);
    setError(null);
    setIsEditing(true);
  };

  const handleCancel = (): void => {
    setContent(template.effective.content);
    setSuccessMessage(null);
    setError(null);
    setIsEditing(false);
  };

  const finishSubmission = (): void => {
    submissionLock.current = false;
    setIsSubmitting(false);
  };

  const handleSubmit = (): void => {
    if (
      disabled ||
      !canSave ||
      submissionLock.current ||
      isSubmitting ||
      createProposal.isPending
    ) {
      return;
    }

    submissionLock.current = true;
    setIsSubmitting(true);
    setSuccessMessage(null);
    setError(null);

    try {
      const request = createProposal.mutate({
        organizationId,
        projectId,
        eli5,
        templateKey: template.templateKey,
        selector,
        syntaxVersion,
        content,
        expectedEffectiveRevision: {
          revisionId: template.effective.revisionId,
          revisionNumber: template.effective.revisionNumber,
        },
      });
      void request
        .then((proposal) => {
          onProposalCreated?.(proposal);
          setIsEditing(false);
          setSuccessMessage(
            "Change proposal created. The effective template will change only after approval."
          );
        })
        .catch((caughtError: unknown) => {
          setError(getErrorMessage(caughtError));
        })
        .finally(finishSubmission);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      finishSubmission();
    }
  };

  const isPending = disabled || isSubmitting || createProposal.isPending;

  return (
    <Card
      component="section"
      variant="outlined"
      data-testid="entity-prompt-template-override-editor"
    >
      <CardContent>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={3}
          alignItems="flex-start"
        >
          <Stack spacing={3} sx={{ flex: 3, minWidth: 0 }}>
            <Stack spacing={2} data-testid="entity-prompt-template-current">
              {isEditing ? (
                <>
                  <Box>
                    <Typography component="h3" variant="subtitle1">
                      Edit template
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Changes stay local until you submit them through standard
                      proposal review. The published template remains
                      authoritative until approval.
                    </Typography>
                  </Box>
                  <EntityPromptTemplateEditor
                    source={{ content, syntaxVersion }}
                    onChange={handleContentChange}
                    readOnly={isPending}
                    validation={validation}
                  />
                  <TextField
                    fullWidth
                    label="Explain this change in one sentence"
                    value={eli5}
                    onChange={(event) => setEli5(event.target.value)}
                    inputProps={{ maxLength: 150 }}
                    disabled={isPending}
                    data-testid="entity-prompt-template-change-eli5"
                  />
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="contained"
                      onClick={handleSubmit}
                      disabled={isPending || !canSave}
                      data-testid="entity-prompt-template-propose-change"
                    >
                      {isPending ? (
                        <>
                          <CircularProgress size={18} sx={{ mr: 1 }} />
                          Creating proposal…
                        </>
                      ) : (
                        "Save"
                      )}
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={handleCancel}
                      disabled={isPending}
                      data-testid="entity-prompt-template-edit-cancel"
                    >
                      Cancel
                    </Button>
                  </Stack>
                </>
              ) : (
                <>
                  <CurrentTemplateContent
                    content={template.effective.content}
                  />
                  <Button
                    variant="outlined"
                    onClick={handleEdit}
                    disabled={disabled}
                    data-testid="entity-prompt-template-edit"
                  >
                    Edit
                  </Button>
                </>
              )}

              <EntityPromptTemplateProposalActions
                organizationId={organizationId}
                projectId={projectId}
                proposals={proposals}
                error={proposalsError}
                templateKey={template.templateKey}
                selector={selector}
                onReviseRejected={onReviseRejected}
                onPendingOperationChange={onPendingOperationChange}
              />

              <CurrentTemplateMetadata
                template={template}
                selectorLabel={
                  compositionMetadata.templateLanguage.selectorLabel
                }
              />
            </Stack>

            {template.effective.ownershipSource.scope === "PROJECT" &&
              template.canonicalDefault && (
                <StandardTemplatePresentation
                  canonicalDefault={template.canonicalDefault}
                />
              )}

            {successMessage && (
              <Alert
                severity="success"
                data-testid="entity-prompt-template-proposal-success"
              >
                {successMessage}
              </Alert>
            )}

            {error && (
              <Alert
                severity="error"
                data-testid="entity-prompt-template-proposal-error"
              >
                <AlertTitle>Unable to create change proposal</AlertTitle>
                {error}
              </Alert>
            )}
          </Stack>
          {renderTemplateLanguageHelp(compositionMetadata)}
        </Stack>
      </CardContent>
    </Card>
  );
};

EntityPromptTemplateOverrideEditor.displayName =
  "EntityPromptTemplateOverrideEditor";
