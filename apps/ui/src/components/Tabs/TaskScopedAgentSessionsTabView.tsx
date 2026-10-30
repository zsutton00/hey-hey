import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import type {
  AgentSessionDto,
  ContextRelatedEntityDto,
} from "@hey-hey/ui-common/api";
import {
  AgentSessionCurrentStateIndicator,
  EntityActionButton,
  EntityFilters,
  EntityGrid,
  EntityListItem,
  agentSessionAdapter,
  MINI_DEMO_TARGETS,
} from "@hey-hey/ui-common/components";
import type { FilterConfig } from "@hey-hey/ui-common/components";
import { TERMS } from "@hey-hey/ui-common/i18n";
import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
} from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";
import { TabContainer } from "./TabContainer";

export interface TaskScopedAgentSessionsTabViewProps {
  // identifiers
  organizationId: string;
  projectId: string;
  taskId: string;

  // session list
  sessions: AgentSessionDto[];
  isLoading: boolean;
  emptyMessage?: string;
  sessionList?: React.ReactNode;

  // search/sort state
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  sortBy: string;
  onSortByChange: (value: string) => void;

  // filter visibility
  enableFilters: boolean;

  // create-session flow
  isCreatingNew: boolean;
  isUpdatingTaskStatus: boolean;
  unfinishedDependencies: readonly ContextRelatedEntityDto[];
  isBacklogDialogOpen: boolean;
  error: string | null;
  onStartNewSession: () => void;
  onContinueDependencyWarning: () => void;
  onCancelDependencyWarning: () => void;
  onConfirmBacklogDialog: () => void;
  onCancelBacklogDialog: () => void;

  // session-row actions
  buildSessionPath: (agentSessionId: string) => string;
  onDeleteSession: (sessionId: string) => () => Promise<void>;
}

export const TaskScopedAgentSessionsTabView: React.FC<
  TaskScopedAgentSessionsTabViewProps
> = ({
  organizationId,
  projectId,
  taskId,
  sessions,
  isLoading,
  emptyMessage,
  sessionList,
  searchTerm,
  onSearchTermChange,
  sortBy,
  onSortByChange,
  enableFilters,
  isCreatingNew,
  isUpdatingTaskStatus,
  unfinishedDependencies,
  isBacklogDialogOpen,
  error,
  onStartNewSession,
  onContinueDependencyWarning,
  onCancelDependencyWarning,
  onConfirmBacklogDialog,
  onCancelBacklogDialog,
  buildSessionPath,
  onDeleteSession,
}) => {
  const { t } = useTranslation();

  const defaultEmptyMessage = t(
    "codingSessions.emptyTask",
    "No coding sessions found for this task yet.",
  );

  const filters: FilterConfig[] = [
    {
      type: "search",
      key: "search",
      label: t(
        "codingSessions.filters.searchPlaceholder",
        "Search coding sessions...",
      ),
      placeholder: t(
        "codingSessions.filters.searchPlaceholder",
        "Search coding sessions...",
      ),
    },
  ];

  const sortOptions = [
    {
      value: "created-desc",
      label: t("common.sortCreatedDesc", "Newest first"),
    },
    {
      value: "created-asc",
      label: t("common.sortCreatedAsc", "Oldest first"),
    },
    {
      value: "name-asc",
      label: t("common.sortNameAsc", "Name (A-Z)"),
    },
    {
      value: "name-desc",
      label: t("common.sortNameDesc", "Name (Z-A)"),
    },
  ];

  return (
    <TabContainer>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <EntityActionButton
            data-testid="task-agent-sessions-start-new-session-button"
            data-demo-target={MINI_DEMO_TARGETS.startNewSessionButton}
            variant="contained"
            verb="start"
            noun={TERMS.AgentSession}
            entityType="agent_session"
            loading={isCreatingNew || isUpdatingTaskStatus}
            loadingLabel={
              isUpdatingTaskStatus
                ? t("common.updating", "Updating...")
                : t("common.creating", "Creating...")
            }
            onClick={onStartNewSession}
            disabled={
              isCreatingNew ||
              isUpdatingTaskStatus ||
              !organizationId ||
              !projectId ||
              !taskId
            }
          />
        </Stack>

        <Dialog
          data-testid="task-session-dependency-warning-dialog"
          open={unfinishedDependencies.length > 0}
          onClose={onCancelDependencyWarning}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            {t(
              "codingSessions.dependencyWarning.title",
              "Unfinished dependencies",
            )}
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              {t(
                "codingSessions.dependencyWarning.message",
                "This task depends on unfinished work. You can continue anyway or cancel the launch.",
              )}
            </DialogContentText>
            <Stack component="ul" spacing={0.5} sx={{ mb: 0, pl: 3 }}>
              {unfinishedDependencies.map((dependency) => (
                <li key={dependency.entityId}>{dependency.displayName}</li>
              ))}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button
              data-testid="task-session-dependency-warning-cancel-button"
              onClick={onCancelDependencyWarning}
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              data-testid="task-session-dependency-warning-continue-button"
              onClick={onContinueDependencyWarning}
              color="warning"
              variant="contained"
            >
              {t("common.continue", "Continue")}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={isBacklogDialogOpen}
          onClose={onCancelBacklogDialog}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>
            {t("codingSessions.backlogDialog.title", "Task is in backlog")}
          </DialogTitle>
          <DialogContent>
            {t(
              "codingSessions.backlogDialog.message",
              "Do you want to set this task to Active before starting a coding session?",
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={onCancelBacklogDialog}
              disabled={isUpdatingTaskStatus}
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              onClick={onConfirmBacklogDialog}
              variant="contained"
              disabled={isUpdatingTaskStatus}
            >
              {isUpdatingTaskStatus
                ? t("common.updating", "Updating...")
                : t("codingSessions.backlogDialog.confirm", "Set to Active")}
            </Button>
          </DialogActions>
        </Dialog>

        {error ? <Alert severity="error">{error}</Alert> : null}

        {enableFilters && (
          <EntityFilters
            filters={filters}
            values={{ search: searchTerm }}
            onChange={(key: string, value: unknown) => {
              if (key === "search") {
                onSearchTermChange(value as string);
              }
            }}
            sortOptions={sortOptions}
            sortBy={sortBy}
            onSortChange={onSortByChange}
            layout="row"
            spacing={2}
          />
        )}

        {sessionList ?? (
          <EntityGrid
            items={sessions}
            loading={isLoading}
            renderItem={(session: AgentSessionDto) => {
              const props = agentSessionAdapter.toEntityListItemProps(session, {
                projectId,
              });
              return (
                <EntityListItem
                  {...props}
                  href={buildSessionPath(session.id)}
                  statusLeadingAdornment={
                    <AgentSessionCurrentStateIndicator
                      currentState={session.currentState}
                      presentation="icon"
                    />
                  }
                  onDelete={onDeleteSession(session.id)}
                />
              );
            }}
            keyExtractor={(session) => session.id}
            emptyMessage={emptyMessage || defaultEmptyMessage}
          />
        )}
      </Stack>
    </TabContainer>
  );
};
