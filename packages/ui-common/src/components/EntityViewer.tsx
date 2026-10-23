import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type {
  ConversationResponseDto,
  DesignDocResponseDto,
  EntityType,
  InitiativeResponseDto,
  MessageRecordDto,
  ProjectResponseDto,
  ServiceDto,
  TaskResponseDto,
  SystemMessageData,
  UserMessageData,
} from "../api";
import { EntityType as EntityTypeEnum, TargetEntityType } from "../api";
import { useConversation } from "../data/hooks/useConversation";
import { useDesignDoc } from "../data/hooks/useDesignDoc";
import { useInitiative } from "../data/hooks/useInitiative";
import { useMessage } from "../data/hooks/useMessage";
import { useProject } from "../data/hooks/useProject";
import { useService } from "../data/hooks/useService";
import { useWorkItem } from "../data/hooks/useWorkItem";
import { useWorkItemTypeByKey } from "../data/hooks/useWorkItemTypes";
import {
  ConversationViewer,
  DISABLED_CONVERSATION_SCROLL_POLICY,
} from "./Conversation/ConversationViewer";
import { SystemMessage } from "./Conversation/Components/SystemMessage";
import { InteractionComponent } from "./InteractionComponent/InteractionComponent";
import { EntityStarToggle } from "./Entity/EntityStarToggle";
import { DesignDocReadView } from "./shared";
import { WorkItemReadView } from "./shared/WorkItemReadView";
import {
  selectWorkItemSections,
  type ResolvedWorkItemSectionSelection,
} from "../utils/workItemSections";

const INITIATIVE_SECTION_SELECTION: ResolvedWorkItemSectionSelection = {
  status: "resolved",
  typeKey: "INITIATIVE",
  sections: [
    { key: "description", label: "Description" },
    { key: "acceptanceCriteria", label: "Acceptance Criteria" },
  ],
};

type EntityViewerProps =
  | {
      entityType: typeof EntityTypeEnum.Task;
      entity: TaskResponseDto;
      organizationId?: string;
      projectId?: string;
    }
  | {
      entityType: typeof EntityTypeEnum.Initiative;
      entity: InitiativeResponseDto;
      organizationId?: string;
    }
  | {
      entityType: typeof EntityTypeEnum.DesignDoc;
      entity: DesignDocResponseDto;
      organizationId?: string;
      projectId?: string;
    }
  | {
      entityType: typeof EntityTypeEnum.Conversation;
      entity: ConversationResponseDto;
      project: ProjectResponseDto;
      organizationId?: string;
      readOnly?: boolean;
    }
  | {
      entityType: typeof EntityTypeEnum.Message;
      entity: MessageRecordDto;
      organizationId?: string;
    }
  | {
      entityType: typeof EntityTypeEnum.Service;
      entity: ServiceDto;
      organizationId?: string;
    };

type EntityViewerLoaderProps =
  | {
      source: "entity";
      entityType: typeof EntityTypeEnum.Task;
      entity: TaskResponseDto;
      organizationId: string;
      projectId?: string;
    }
  | {
      source: "entity";
      entityType: typeof EntityTypeEnum.Initiative;
      entity: InitiativeResponseDto;
      organizationId: string;
      projectId?: string;
    }
  | {
      source: "entity";
      entityType: typeof EntityTypeEnum.DesignDoc;
      entity: DesignDocResponseDto;
      organizationId: string;
      projectId?: string;
    }
  | {
      source: "entity";
      entityType: typeof EntityTypeEnum.Conversation;
      entity: ConversationResponseDto;
      organizationId: string;
      projectId?: string;
    }
  | {
      source: "entity";
      entityType: typeof EntityTypeEnum.Message;
      entity: MessageRecordDto;
      organizationId: string;
      projectId?: string;
    }
  | {
      source: "entity";
      entityType: typeof EntityTypeEnum.Service;
      entity: ServiceDto;
      organizationId: string;
      projectId?: string;
    }
  | {
      source: "lookup";
      entityType: EntityType;
      entityId: string;
      organizationId: string;
      projectId?: string;
    };

const TaskEntityViewer: React.FC<{
  entity: TaskResponseDto;
  organizationId?: string;
  projectId?: string;
}> = ({ entity, organizationId, projectId }) => {
  const resolvedOrganizationId = organizationId ?? entity.organizationId;
  const resolvedProjectId = projectId ?? entity.projectId;
  const { workItemTypeDefinition, isFetched: isWorkItemTypeFetched } =
    useWorkItemTypeByKey(
      resolvedOrganizationId,
      resolvedProjectId,
      entity.type
    );
  const sectionSelection = useMemo(
    () =>
      selectWorkItemSections({
        typeKey: entity.type,
        definition: workItemTypeDefinition,
        isFetched: isWorkItemTypeFetched,
      }),
    [entity.type, isWorkItemTypeFetched, workItemTypeDefinition]
  );
  return (
    <InteractionComponent
      entityId={entity.id}
      entityType={TargetEntityType.Task}
      entitySubtype={entity.type}
      hasProposalSupport
      organizationId={resolvedOrganizationId}
      projectId={resolvedProjectId}
      entityTitle={entity.name}
      size="medium"
      indicatorOffsetX={-22}
      indicatorOffsetY={-22}
    >
      <WorkItemReadView
        sections={entity.sections}
        sectionSelection={sectionSelection}
        htmlCssRenderingContext="page"
      />
    </InteractionComponent>
  );
};

type EntityViewerRoute = EntityViewerLoaderProps;

interface BreadcrumbState {
  parentLabel: "Conversation" | "Initiative";
  childLabel: "Message" | "Task";
  parentView?: EntityViewerRoute;
  childView?: EntityViewerRoute;
}

const LoadingState: React.FC = () => (
  <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
    <CircularProgress size={32} />
  </Box>
);

const EntityPageTitle: React.FC<{
  title: string;
  entityType: EntityType;
  entityId: string;
  organizationId?: string;
}> = ({ title, entityType, entityId, organizationId }) => (
  <Stack
    direction="row"
    alignItems="center"
    spacing={1}
    data-testid="entity-page-title"
  >
    <Typography variant="h5" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
      {title}
    </Typography>
    {organizationId && (
      <EntityStarToggle
        organizationId={organizationId}
        entityType={entityType}
        entityId={entityId}
        size="medium"
        testId="entity-page-star-toggle"
      />
    )}
  </Stack>
);

const ErrorState: React.FC<{ message: string }> = ({ message }) => (
  <Box sx={{ py: 4 }}>
    <Typography color="error">{message}</Typography>
  </Box>
);

const MessageReadView: React.FC<{ message: MessageRecordDto }> = ({
  message,
}) => {
  if (message.type === "SYSTEM") {
    const data = message.data as SystemMessageData | undefined;
    const response =
      typeof data?.response === "string" ? data.response : undefined;

    if (!response) {
      return (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="subtitle2" color="text.secondary">
              System Message
            </Typography>
            <Typography variant="body2" color="text.secondary">
              No response content available.
            </Typography>
          </Stack>
        </Paper>
      );
    }

    return (
      <SystemMessage
        animationType="minimal"
        messageData={data}
        type={data?.type ?? "SYSTEM"}
        isCompleted
      />
    );
  }

  const data = message.data as UserMessageData | undefined;
  const comment = data?.comment;
  const fallback = JSON.stringify(data ?? {}, null, 2);

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="subtitle2" color="text.secondary">
          User Message
        </Typography>
        {comment ? (
          <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
            {comment}
          </Typography>
        ) : (
          <Typography component="pre" variant="body2" sx={{ m: 0 }}>
            {fallback}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
};

const ServiceReadView: React.FC<{ service: ServiceDto }> = ({ service }) => (
  <Paper variant="outlined" sx={{ p: 3 }}>
    <Stack spacing={2}>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
        <Typography variant="h6">{service.name}</Typography>
        <Chip size="small" label={service.status} variant="outlined" />
      </Box>
      {service.description && (
        <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
          {service.description}
        </Typography>
      )}
      <Stack direction="row" spacing={1} flexWrap="wrap">
        {service.serviceType && (
          <Chip size="small" label={service.serviceType} variant="outlined" />
        )}
        {service.language && (
          <Chip size="small" label={service.language} variant="outlined" />
        )}
        {service.framework && (
          <Chip size="small" label={service.framework} variant="outlined" />
        )}
      </Stack>
      {service.repositoryUrl && (
        <Typography variant="body2" color="text.secondary">
          Repo: {service.repositoryUrl}
        </Typography>
      )}
    </Stack>
  </Paper>
);

const getEntityViewerKey = (route: EntityViewerRoute): string => {
  if (route.source === "lookup") {
    return `${route.source}:${route.entityType}:${route.entityId}:${
      route.projectId ?? ""
    }`;
  }

  return `${route.source}:${route.entityType}:${route.entity.id}`;
};

export const EntityViewer: React.FC<EntityViewerProps> = (props) => {
  switch (props.entityType) {
    case EntityTypeEnum.Task: {
      return (
        <Stack spacing={3}>
          <EntityPageTitle
            title={props.entity.name}
            entityType={EntityTypeEnum.Task}
            entityId={props.entity.id}
            organizationId={props.organizationId ?? props.entity.organizationId}
          />
          <TaskEntityViewer
            entity={props.entity}
            organizationId={props.organizationId}
            projectId={props.projectId}
          />
        </Stack>
      );
    }
    case EntityTypeEnum.Initiative: {
      return (
        <Stack spacing={3}>
          <EntityPageTitle
            title={props.entity.name}
            entityType={EntityTypeEnum.Initiative}
            entityId={props.entity.id}
            organizationId={props.organizationId ?? props.entity.organizationId}
          />
          <WorkItemReadView
            sections={props.entity.sections}
            sectionSelection={INITIATIVE_SECTION_SELECTION}
          />
        </Stack>
      );
    }
    case EntityTypeEnum.DesignDoc:
      return (
        <Stack spacing={3}>
          <EntityPageTitle
            title={props.entity.name}
            entityType={EntityTypeEnum.DesignDoc}
            entityId={props.entity.id}
            organizationId={props.organizationId ?? props.entity.organizationId}
          />
          <DesignDocReadView
            title={props.entity.name}
            summary={props.entity.summary}
            sections={props.entity.sections}
            status={props.entity.status}
            alignmentCheck={
              props.organizationId && props.projectId
                ? {
                    organizationId: props.organizationId,
                    projectId: props.projectId,
                    designDocId: props.entity.id,
                  }
                : undefined
            }
          />
        </Stack>
      );
    case EntityTypeEnum.Conversation:
      return (
        <Stack spacing={3}>
          <EntityPageTitle
            title={props.entity.title ?? "Conversation"}
            entityType={EntityTypeEnum.Conversation}
            entityId={props.entity.id}
            organizationId={props.organizationId ?? props.entity.organizationId}
          />
          <ConversationViewer
            scrollPolicy={DISABLED_CONVERSATION_SCROLL_POLICY}
            conversation={props.entity}
            project={props.project}
            animationType="minimal"
            readOnly={props.readOnly}
            showNavigation={false}
          />
        </Stack>
      );
    case EntityTypeEnum.Message:
      return (
        <Stack spacing={3}>
          <EntityPageTitle
            title="Message"
            entityType={EntityTypeEnum.Message}
            entityId={props.entity.id}
            organizationId={props.organizationId}
          />
          <MessageReadView message={props.entity} />
        </Stack>
      );
    case EntityTypeEnum.Service:
      return (
        <Stack spacing={3}>
          <EntityPageTitle
            title={props.entity.name}
            entityType={EntityTypeEnum.Service}
            entityId={props.entity.id}
            organizationId={props.organizationId ?? props.entity.organizationId}
          />
          <ServiceReadView service={props.entity} />
        </Stack>
      );
    default:
      return null;
  }
};

export const EntityViewerLoader: React.FC<EntityViewerLoaderProps> = (
  props
) => {
  const [viewStack, setViewStack] = useState<EntityViewerRoute[]>([]);
  const [activeView, setActiveView] = useState<EntityViewerRoute>(props);
  const rootKey = getEntityViewerKey(props);
  const activeKey = getEntityViewerKey(activeView);

  useEffect(() => {
    setActiveView(props);
    setViewStack([]);
  }, [rootKey]);

  const { entityType, organizationId } = activeView;
  const projectId =
    activeView.source === "lookup" ? activeView.projectId : undefined;
  const entityId =
    activeView.source === "lookup" ? activeView.entityId : undefined;
  const resolvedConversationProjectId =
    activeView.source === "entity" && entityType === EntityTypeEnum.Conversation
      ? activeView.entity.projectId
      : projectId;

  const taskQuery = useWorkItem(organizationId, "task", entityId ?? "", {
    enabled:
      entityType === EntityTypeEnum.Task && activeView.source === "lookup",
  });

  const initiativeQuery = useInitiative(organizationId, entityId ?? "", {
    enabled:
      entityType === EntityTypeEnum.Initiative &&
      activeView.source === "lookup",
  });

  const designDocQuery = useDesignDoc(organizationId, entityId, {
    enabled:
      entityType === EntityTypeEnum.DesignDoc && activeView.source === "lookup",
  });

  const conversationQuery = useConversation(
    organizationId,
    projectId,
    {
      conversationId: entityId ?? "",
    },
    {
      enabled:
        entityType === EntityTypeEnum.Conversation &&
        activeView.source === "lookup" &&
        !!projectId,
    }
  );

  const messageQuery = useMessage(organizationId, projectId, entityId, {
    enabled:
      entityType === EntityTypeEnum.Message &&
      activeView.source === "lookup" &&
      !!projectId,
  });

  const serviceQuery = useService(organizationId, entityId, {
    enabled:
      entityType === EntityTypeEnum.Service && activeView.source === "lookup",
  });

  const projectQuery = useProject(
    organizationId,
    resolvedConversationProjectId,
    {
      enabled:
        entityType === EntityTypeEnum.Conversation &&
        !!resolvedConversationProjectId,
    }
  );

  const missingProjectIdError =
    activeView.source === "lookup" &&
    entityType === EntityTypeEnum.Conversation &&
    !projectId
      ? "Project ID is required to load conversation details."
      : activeView.source === "lookup" &&
        entityType === EntityTypeEnum.Message &&
        !projectId
      ? "Project ID is required to load message details."
      : null;

  const isLoading =
    activeView.source === "entity"
      ? entityType === EntityTypeEnum.Conversation &&
        (projectQuery.isLoading || !projectQuery.data)
      : (() => {
          switch (entityType) {
            case EntityTypeEnum.Task:
              return taskQuery.isLoading;
            case EntityTypeEnum.Initiative:
              return initiativeQuery.isLoading;
            case EntityTypeEnum.DesignDoc:
              return designDocQuery.isLoading;
            case EntityTypeEnum.Conversation:
              return conversationQuery.isLoading || projectQuery.isLoading;
            case EntityTypeEnum.Message:
              return messageQuery.isLoading;
            case EntityTypeEnum.Service:
              return serviceQuery.isLoading;
            default:
              return false;
          }
        })();

  const errorMessage =
    missingProjectIdError ??
    (() => {
      if (activeView.source === "entity") {
        if (entityType === EntityTypeEnum.Conversation) {
          if (!resolvedConversationProjectId) {
            return "Project ID is required to load conversation details.";
          }
          return projectQuery.error?.message || null;
        }
        return null;
      }

      switch (entityType) {
        case EntityTypeEnum.Task:
          return taskQuery.error?.message ?? null;
        case EntityTypeEnum.Initiative:
          return initiativeQuery.error?.message ?? null;
        case EntityTypeEnum.DesignDoc:
          return designDocQuery.error?.message ?? null;
        case EntityTypeEnum.Conversation:
          return (
            conversationQuery.error?.message ??
            projectQuery.error?.message ??
            null
          );
        case EntityTypeEnum.Message:
          return messageQuery.error?.message ?? null;
        case EntityTypeEnum.Service:
          return serviceQuery.error?.message ?? null;
        default:
          return null;
      }
    })();

  const resolvedEntityView = (() => {
    if (activeView.source === "entity") {
      switch (entityType) {
        case EntityTypeEnum.Task:
          return (
            <EntityViewer
              entityType={EntityTypeEnum.Task}
              entity={activeView.entity}
              organizationId={organizationId}
              projectId={activeView.projectId}
            />
          );
        case EntityTypeEnum.Initiative:
          return (
            <EntityViewer
              entityType={EntityTypeEnum.Initiative}
              entity={activeView.entity}
              organizationId={organizationId}
            />
          );
        case EntityTypeEnum.DesignDoc:
          return (
            <EntityViewer
              entityType={EntityTypeEnum.DesignDoc}
              entity={activeView.entity}
              organizationId={organizationId}
              projectId={activeView.projectId}
            />
          );
        case EntityTypeEnum.Message:
          return (
            <EntityViewer
              entityType={EntityTypeEnum.Message}
              entity={activeView.entity}
              organizationId={organizationId}
            />
          );
        case EntityTypeEnum.Service:
          return (
            <EntityViewer
              entityType={EntityTypeEnum.Service}
              entity={activeView.entity}
              organizationId={organizationId}
            />
          );
        case EntityTypeEnum.Conversation:
          return projectQuery.data ? (
            <EntityViewer
              entityType={EntityTypeEnum.Conversation}
              entity={activeView.entity}
              project={projectQuery.data}
              organizationId={organizationId}
              readOnly={true}
            />
          ) : null;
        default:
          return null;
      }
    }

    switch (entityType) {
      case EntityTypeEnum.Task:
        return taskQuery.workItem ? (
          <EntityViewer
            entityType={EntityTypeEnum.Task}
            entity={taskQuery.workItem as TaskResponseDto}
            organizationId={organizationId}
            projectId={projectId}
          />
        ) : null;
      case EntityTypeEnum.Initiative:
        return initiativeQuery.data ? (
          <EntityViewer
            entityType={EntityTypeEnum.Initiative}
            entity={initiativeQuery.data}
            organizationId={organizationId}
          />
        ) : null;
      case EntityTypeEnum.DesignDoc:
        return designDocQuery.data ? (
          <EntityViewer
            entityType={EntityTypeEnum.DesignDoc}
            entity={designDocQuery.data}
            organizationId={organizationId}
            projectId={projectId}
          />
        ) : null;
      case EntityTypeEnum.Conversation:
        return conversationQuery.data && projectQuery.data ? (
          <EntityViewer
            entityType={EntityTypeEnum.Conversation}
            entity={conversationQuery.data}
            project={projectQuery.data}
            organizationId={organizationId}
            readOnly={true}
          />
        ) : null;
      case EntityTypeEnum.Message:
        return messageQuery.data ? (
          <EntityViewer
            entityType={EntityTypeEnum.Message}
            entity={messageQuery.data}
            organizationId={organizationId}
          />
        ) : null;
      case EntityTypeEnum.Service:
        return serviceQuery.data ? (
          <EntityViewer
            entityType={EntityTypeEnum.Service}
            entity={serviceQuery.data}
            organizationId={organizationId}
          />
        ) : null;
      default:
        return (
          <ErrorState
            message={`Entity type "${entityType}" is not supported.`}
          />
        );
    }
  })();

  const breadcrumbState = (() => {
    const lastStackItem = viewStack[viewStack.length - 1];
    if (entityType === EntityTypeEnum.Message) {
      const messageEntity =
        activeView.source === "entity" ? activeView.entity : messageQuery.data;

      if (!messageEntity) {
        return {
          parentLabel: "Conversation",
          childLabel: "Message",
        } satisfies BreadcrumbState;
      }

      const parentView: EntityViewerRoute = {
        source: "lookup",
        entityType: EntityTypeEnum.Conversation,
        entityId: messageEntity.conversationId,
        organizationId,
        projectId: messageEntity.projectId,
      };

      return {
        parentLabel: "Conversation",
        childLabel: "Message",
        parentView,
      } satisfies BreadcrumbState;
    }

    if (entityType === EntityTypeEnum.Task) {
      const taskEntity =
        activeView.source === "entity" ? activeView.entity : taskQuery.workItem;

      if (!taskEntity) {
        return {
          parentLabel: "Initiative",
          childLabel: "Task",
        } satisfies BreadcrumbState;
      }

      const initiativeId = (taskEntity as TaskResponseDto).initiativeId;

      if (!initiativeId) {
        return {
          parentLabel: "Initiative",
          childLabel: "Task",
        } satisfies BreadcrumbState;
      }

      const parentView: EntityViewerRoute = {
        source: "lookup",
        entityType: EntityTypeEnum.Initiative,
        entityId: initiativeId,
        organizationId,
      };

      return {
        parentLabel: "Initiative",
        childLabel: "Task",
        parentView,
      } satisfies BreadcrumbState;
    }

    if (entityType === EntityTypeEnum.Conversation && lastStackItem) {
      if (lastStackItem.entityType === EntityTypeEnum.Message) {
        return {
          parentLabel: "Conversation",
          childLabel: "Message",
          childView: lastStackItem,
        } satisfies BreadcrumbState;
      }
    }

    if (entityType === EntityTypeEnum.Initiative && lastStackItem) {
      if (lastStackItem.entityType === EntityTypeEnum.Task) {
        return {
          parentLabel: "Initiative",
          childLabel: "Task",
          childView: lastStackItem,
        } satisfies BreadcrumbState;
      }
    }

    return null;
  })();

  const handleNavigateToView = (view: EntityViewerRoute | undefined): void => {
    if (!view) return;
    const nextKey = getEntityViewerKey(view);
    if (nextKey === activeKey) return;
    setViewStack((prev) => [...prev, activeView]);
    setActiveView(view);
  };

  const handleReturnToChild = (): void => {
    setViewStack((prev) => {
      if (prev.length === 0) return prev;
      const nextView = prev[prev.length - 1];
      setActiveView(nextView);
      return prev.slice(0, -1);
    });
  };

  const breadcrumb = breadcrumbState ? (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        mb: 2,
      }}
    >
      <Breadcrumbs
        aria-label="entity-preview-breadcrumbs"
        sx={{ "& .MuiBreadcrumbs-separator": { mx: 0.75 } }}
      >
        {breadcrumbState.parentView ? (
          <Button
            variant="text"
            size="small"
            onClick={() => handleNavigateToView(breadcrumbState.parentView)}
            sx={{ textTransform: "none", minWidth: "auto", p: 0 }}
          >
            {breadcrumbState.parentLabel}
          </Button>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {breadcrumbState.parentLabel}
          </Typography>
        )}
        {breadcrumbState.childView ? (
          <Button
            variant="text"
            size="small"
            onClick={handleReturnToChild}
            sx={{ textTransform: "none", minWidth: "auto", p: 0 }}
          >
            {breadcrumbState.childLabel}
          </Button>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {breadcrumbState.childLabel}
          </Typography>
        )}
      </Breadcrumbs>
      {isLoading && <CircularProgress size={16} />}
    </Box>
  ) : null;

  const content = errorMessage ? (
    <ErrorState message={errorMessage} />
  ) : isLoading ? (
    <LoadingState />
  ) : (
    resolvedEntityView
  );

  if (!breadcrumb) {
    return content;
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      {breadcrumb}
      {content}
    </Box>
  );
};
