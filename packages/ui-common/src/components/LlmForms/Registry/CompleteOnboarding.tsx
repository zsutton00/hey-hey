import React, { useState } from "react";
import {
  Box,
  Button,
  Typography,
  Paper,
  Stack,
  CircularProgress,
  Alert,
  Chip,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/CheckCircleOutline";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import type { FieldComponentProps } from "./types";
import { usePathService } from "../../../contexts";
import { useProjectCapabilities, useUserIdentity } from "../../../hooks";
import { ProjectStatus } from "../../../api";
import { apiClient } from "../../../clients/client";
import { KEYS } from "../../../i18n/keys";
import {
  useFeatureHierarchy,
  type FeatureHierarchyNode,
} from "../../../data/hooks/useFeatureHierarchy";
import type {
  RepositoryPlacementCandidateRoot,
  RepositoryPlacementCompletionTarget,
} from "../../../api";

export type CompleteOnboardingProps = FieldComponentProps<boolean>;

interface ExistingProjectImportCompletionPayload {
  mode: "existing_project_import";
  roots: RepositoryPlacementCandidateRoot[];
  placements: RepositoryPlacementAssignment[];
}

interface RepositoryPlacementAssignment {
  rootKey: string;
  target: RepositoryPlacementCompletionTarget;
  rationale?: string;
  confidence?: number;
}

const isExistingProjectImportCompletion = (
  payload: unknown
): payload is ExistingProjectImportCompletionPayload =>
  typeof payload === "object" &&
  payload !== null &&
  "mode" in payload &&
  payload.mode === "existing_project_import" &&
  "roots" in payload &&
  Array.isArray(payload.roots) &&
  "placements" in payload &&
  Array.isArray(payload.placements);

const STEM_HEIGHT = 18;
const CHILD_GAP = 2.5;

interface ChildConnectorProps {
  index: number;
  total: number;
}

const ChildConnector: React.FC<ChildConnectorProps> = ({ index, total }) => {
  const isOnly = total === 1;
  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        height: STEM_HEIGHT,
      }}
    >
      {!isOnly && !isFirst && (
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: -10,
            right: "50%",
            height: "2px",
            bgcolor: "divider",
          }}
        />
      )}
      {!isOnly && !isLast && (
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: "50%",
            right: -10,
            height: "2px",
            bgcolor: "divider",
          }}
        />
      )}
      <Box
        sx={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "calc(50% - 1px)",
          width: "2px",
          bgcolor: "divider",
        }}
      />
    </Box>
  );
};

interface TaskGhostStackProps {
  tasksPlaceholder: string;
}

const TaskGhostStack: React.FC<TaskGhostStackProps> = ({
  tasksPlaceholder,
}) => (
  <Stack spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
    {[0, 1].map((i) => (
      <Chip
        key={i}
        label={tasksPlaceholder}
        variant="outlined"
        size="small"
        sx={{
          borderStyle: "dashed",
          opacity: 0.6,
          color: "text.secondary",
          minWidth: 100,
        }}
      />
    ))}
    <Typography
      variant="caption"
      sx={{
        color: "text.disabled",
        letterSpacing: 2,
        lineHeight: 1,
        mt: 0.25,
      }}
    >
      •••
    </Typography>
  </Stack>
);

interface FeatureTreeBranchProps {
  node: FeatureHierarchyNode;
  isRoot: boolean;
  tasksPlaceholder: string;
}

const FeatureTreeBranch: React.FC<FeatureTreeBranchProps> = ({
  node,
  isRoot,
  tasksPlaceholder,
}) => {
  const hasChildren = node.children.length > 0;

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <Paper
        variant={isRoot ? "elevation" : "outlined"}
        elevation={isRoot ? 2 : 0}
        sx={{
          px: 2,
          py: 1.25,
          minWidth: 130,
          maxWidth: 200,
          textAlign: "center",
          bgcolor: isRoot ? "heyhey.main" : "background.paper",
          color: isRoot ? "heyhey.contrastText" : "text.primary",
          borderColor: isRoot ? "heyhey.main" : "divider",
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontWeight: isRoot ? 700 : 600,
            lineHeight: 1.25,
            wordBreak: "break-word",
          }}
        >
          {node.feature.name}
        </Typography>
      </Paper>

      {hasChildren ? (
        <>
          <Box
            sx={{
              width: "2px",
              height: STEM_HEIGHT,
              bgcolor: "divider",
            }}
          />
          <Box
            sx={{
              display: "flex",
              gap: CHILD_GAP,
              alignItems: "flex-start",
              justifyContent: "center",
              flexWrap: "wrap",
              rowGap: 4,
            }}
          >
            {node.children.map((child, idx) => (
              <Box
                key={child.feature.id}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <ChildConnector index={idx} total={node.children.length} />
                <FeatureTreeBranch
                  node={child}
                  isRoot={false}
                  tasksPlaceholder={tasksPlaceholder}
                />
              </Box>
            ))}
          </Box>
        </>
      ) : (
        <>
          <Box
            sx={{
              width: "2px",
              height: 12,
              bgcolor: "divider",
            }}
          />
          <TaskGhostStack tasksPlaceholder={tasksPlaceholder} />
        </>
      )}
    </Box>
  );
};

interface ImportedFeatureCompletionProps {
  payload: ExistingProjectImportCompletionPayload;
  value?: boolean;
  onChange?: (value: boolean) => void;
  error?: string;
  disabled: boolean;
  isSubmitted: boolean;
}

const ImportedFeatureCompletion: React.FC<ImportedFeatureCompletionProps> = ({
  payload,
  value,
  onChange,
  error,
  disabled,
  isSubmitted,
}) => {
  const placementByRoot = new Map(
    payload.placements.map((placement) => [placement.rootKey, placement])
  );

  if (isSubmitted && value) {
    return (
      <Box sx={{ mb: 2 }}>
        <Paper elevation={0} sx={{ p: 3, bgcolor: "success.light" }}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <CheckIcon sx={{ color: "success.main" }} />
            <Typography variant="h6" color="success.main">
              Features imported
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ mt: 1 }}>
            The imported Features are now part of this project.
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 2 }} data-testid="imported-feature-completion">
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h6" gutterBottom>
              Imported Feature hierarchy
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Review the Features added from this Service and where each root
              was placed.
            </Typography>
            <Stack spacing={3}>
              {payload.roots.map((root) => {
                const target = placementByRoot.get(root.rootKey)?.target;
                const parentLabel =
                  target?.kind === "EXISTING_FEATURE"
                    ? `Parent Feature: ${target.featureId}`
                    : "Parent: Project root";
                return (
                  <Paper key={root.rootKey} variant="outlined" sx={{ p: 2 }}>
                    <Stack spacing={1.5}>
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        flexWrap="wrap"
                      >
                        <Typography variant="subtitle1" fontWeight={700}>
                          {root.name}
                        </Typography>
                        <Chip size="small" label={root.tag} />
                        <Chip
                          size="small"
                          variant="outlined"
                          label={parentLabel}
                        />
                      </Stack>
                      {root.children.length > 0 && (
                        <Box
                          sx={{ pl: 2, borderLeft: 2, borderColor: "divider" }}
                        >
                          <Typography variant="caption" color="text.secondary">
                            Imported beneath {root.name}
                          </Typography>
                          {root.children.map((child) => (
                            <Typography
                              key={child.childKey}
                              variant="body2"
                              sx={{ mt: 1 }}
                            >
                              {child.name}
                            </Typography>
                          ))}
                        </Box>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          </Box>
          <Box display="flex" justifyContent="center">
            <Button
              data-testid="finish-import-button"
              variant="contained"
              size="large"
              disabled={disabled}
              startIcon={<CheckIcon />}
              onClick={() => onChange?.(true)}
            >
              Complete Import
            </Button>
          </Box>
        </Stack>
      </Paper>
      {error && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}
    </Box>
  );
};

const NewProjectCompletion: React.FC<CompleteOnboardingProps> = ({
  value,
  onChange,
  error,
  disabled = false,
  isSubmitted = false,
  context: _context,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const pathService = usePathService();
  const userIdentity = useUserIdentity();
  const { currentOrgId } = userIdentity || {};
  const { manageSettings } = useProjectCapabilities(currentOrgId, projectId);

  const [isCompleting, setIsCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);

  const { roots, isLoading: isTreeLoading } = useFeatureHierarchy(
    currentOrgId ?? "",
    projectId ?? ""
  );

  const handleCompleteOnboarding = async () => {
    if (!projectId || !currentOrgId) {
      setCompletionError(t(KEYS.completeOnboarding.errors.missingRequirements));
      return;
    }

    setIsCompleting(true);
    setCompletionError(null);

    try {
      await apiClient.updateProject({
        organizationId: currentOrgId,
        projectId: projectId,
        updateProjectDto: {
          status: ProjectStatus.Active,
        },
      });

      onChange?.(true);

      // Completed question-led onboarding always lands on the Project Page's
      // Help destination, matching the ACTIVE redirect on the Onboarding page.
      const projectPath = pathService.returnToProject(projectId);
      const searchParams = new URLSearchParams({ tab: "help" });
      navigate(`${projectPath}?${searchParams.toString()}`, { replace: true });
    } catch (err) {
      console.error("Failed to complete onboarding:", err);
      setCompletionError(t(KEYS.completeOnboarding.errors.updateFailed));
    } finally {
      setIsCompleting(false);
    }
  };

  if (isSubmitted && value) {
    return (
      <Box sx={{ mb: 2 }}>
        <Paper
          elevation={0}
          sx={{
            p: 3,
            bgcolor: "success.light",
            color: "success.contrastText",
            border: 1,
            borderColor: "success.main",
          }}
        >
          <Stack direction="row" alignItems="center" spacing={2}>
            <CheckIcon sx={{ color: "success.main" }} />
            <Typography variant="h6" color="success.main">
              {t(KEYS.completeOnboarding.completed.title)}
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ mt: 1, opacity: 0.8 }}>
            {t(KEYS.completeOnboarding.completed.subtitle)}
          </Typography>
        </Paper>
      </Box>
    );
  }

  const tasksPlaceholder = t(
    KEYS.completeOnboarding.featureTree.tasksPlaceholder
  );

  return (
    <Box sx={{ mb: 2 }}>
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h6" gutterBottom>
              {t(KEYS.completeOnboarding.featureTree.title)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t(KEYS.completeOnboarding.featureTree.description)}
            </Typography>

            {isTreeLoading ? (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  py: 4,
                }}
              >
                <CircularProgress size={24} />
              </Box>
            ) : roots.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontStyle: "italic", py: 2 }}
              >
                {t(KEYS.completeOnboarding.featureTree.empty)}
              </Typography>
            ) : (
              <Stack
                spacing={5}
                sx={{ alignItems: "center", py: 1, overflowX: "auto" }}
              >
                {roots.map((root) => (
                  <FeatureTreeBranch
                    key={root.feature.id}
                    node={root}
                    isRoot
                    tasksPlaceholder={tasksPlaceholder}
                  />
                ))}
              </Stack>
            )}
          </Box>

          {completionError && <Alert severity="error">{completionError}</Alert>}

          <Box display="flex" justifyContent="center" sx={{ mt: 6 }}>
            {manageSettings ? (
              <Button
                data-testid="complete-onboarding-button"
                variant="contained"
                size="large"
                onClick={handleCompleteOnboarding}
                disabled={disabled || isCompleting}
                startIcon={
                  isCompleting ? <CircularProgress size={20} /> : <CheckIcon />
                }
                sx={{
                  alignSelf: "flex-start",
                  justifySelf: "center",
                  minWidth: 300,
                  fontWeight: 600,
                }}
              >
                {isCompleting
                  ? t(KEYS.completeOnboarding.button.completing)
                  : t(KEYS.completeOnboarding.button.complete)}
              </Button>
            ) : (
              <Typography
                variant="body2"
                color="text.secondary"
                data-testid="complete-onboarding-not-permitted"
              >
                {t(KEYS.completeOnboarding.notPermitted)}
              </Typography>
            )}
          </Box>
        </Stack>
      </Paper>

      {error && (
        <Typography
          variant="caption"
          color="error"
          sx={{ mt: 1, display: "block" }}
        >
          {error}
        </Typography>
      )}
    </Box>
  );
};

export const CompleteOnboarding: React.FC<CompleteOnboardingProps> = (
  props
) => {
  const payload = props.config.payload as unknown;
  if (isExistingProjectImportCompletion(payload)) {
    return (
      <ImportedFeatureCompletion
        payload={payload}
        value={props.value}
        onChange={props.onChange}
        error={props.error}
        disabled={props.disabled ?? false}
        isSubmitted={props.isSubmitted}
      />
    );
  }

  return <NewProjectCompletion {...props} />;
};
