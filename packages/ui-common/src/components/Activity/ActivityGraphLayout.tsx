import {
  Box,
  Breadcrumbs,
  Paper,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  useEdgesState,
  useNodesState,
  type NodeTypes,
} from "reactflow";
import "reactflow/dist/style.css";
import { usePathService } from "../../contexts";
import { EntityType } from "../../api";
import { BreadcrumbLink } from "../BreadcrumbLink";
import { ActivityGraphEntity } from "./ActivityGraphEntity";
import { ActivityGraphMessageNode } from "./ActivityGraphMessageNode";
import { ActivityGraphEntityNode } from "./ActivityGraphEntityNode";
import {
  buildActivityGraphNodes,
  type ConversationMessageOverlay,
} from "./buildActivityGraphNodes";
import {
  ActivityGanttLaneRole,
  ActivityGanttRelationshipType,
  ActivityGanttViewMode,
  getActivityGanttLaneLabel,
  type ActivityGanttBreadcrumbSegment,
  type ActivityGanttChartData,
  type ActivityGanttEntityNode,
  type ActivityGanttLaneRole as ActivityGanttLaneRoleType,
  type ActivityGanttRelationshipType as ActivityGanttRelationshipTypeType,
  type ActivityGanttViewMode as ActivityGanttViewModeType,
} from "./activityGanttPrimitives";
import { resolveActivityGraphEntityHref } from "./activityGraphLinkResolver";

const FOOTER_LANES: ActivityGanttLaneRoleType[] = [
  ActivityGanttLaneRole.Reports,
  ActivityGanttLaneRole.Verification,
];

const nodeTypes: NodeTypes = {
  activityGraphEntityNode: ActivityGraphEntityNode,
  activityGraphMessageNode: ActivityGraphMessageNode,
};

const buildSignalLookup = (
  relationships: ActivityGanttChartData["blockingRelationships"],
): Map<ActivityGanttEntityNode["id"], ActivityGanttRelationshipTypeType[]> => {
  const lookup = new Map<
    ActivityGanttEntityNode["id"],
    Set<ActivityGanttRelationshipTypeType>
  >();

  relationships.forEach((relationship) => {
    if (relationship.type === ActivityGanttRelationshipType.Report) {
      return;
    }

    const sourceSignals = lookup.get(relationship.sourceId) ?? new Set();
    sourceSignals.add(relationship.type);
    lookup.set(relationship.sourceId, sourceSignals);

    const targetSignals = lookup.get(relationship.targetId) ?? new Set();
    targetSignals.add(relationship.type);
    lookup.set(relationship.targetId, targetSignals);
  });

  return new Map(
    Array.from(lookup.entries()).map(([entityId, signalSet]) => [
      entityId,
      Array.from(signalSet),
    ]),
  );
};

const getLaneEntities = (
  chartData: ActivityGanttChartData,
  laneRole: ActivityGanttLaneRoleType,
): ActivityGanttEntityNode[] => {
  switch (laneRole) {
    case ActivityGanttLaneRole.Reports:
      return chartData.reports;
    case ActivityGanttLaneRole.Verification:
      return chartData.verificationRecommendations;
    default:
      return [];
  }
};

const getAllEntities = (
  chartData: ActivityGanttChartData,
): ActivityGanttEntityNode[] => {
  return [
    ...chartData.parentTasks,
    ...chartData.currentWork,
    ...chartData.activeSessions,
    ...chartData.subtasks,
    ...chartData.reports,
    ...chartData.verificationRecommendations,
  ];
};

type ResolvedBreadcrumbSegment = ActivityGanttBreadcrumbSegment & {
  href?: string;
};

const renderFooterLane = (input: {
  laneRole: ActivityGanttLaneRoleType;
  chartData: ActivityGanttChartData;
  projectId?: string;
  signalLookup: Map<
    ActivityGanttEntityNode["id"],
    ActivityGanttRelationshipTypeType[]
  >;
  testIdPrefix: string;
}): React.ReactNode => {
  const laneEntities = getLaneEntities(input.chartData, input.laneRole);
  if (laneEntities.length === 0) {
    return null;
  }

  const laneTestId = `${input.testIdPrefix}-lane-${input.laneRole}`;

  return (
    <Stack data-testid={laneTestId} key={input.laneRole} spacing={1}>
      <Typography data-testid={`${laneTestId}-title`} variant="subtitle2">
        {getActivityGanttLaneLabel(input.laneRole)}
      </Typography>
      <Stack spacing={1}>
        {laneEntities.map((entity) => (
          <ActivityGraphEntity
            entity={entity}
            key={entity.id}
            planScope={input.chartData.planScope}
            projectId={input.projectId}
            signals={input.signalLookup.get(entity.id) ?? []}
          />
        ))}
      </Stack>
    </Stack>
  );
};

const BreadcrumbTrail: React.FC<{
  segments: ResolvedBreadcrumbSegment[];
  originTitle: string;
  testIdPrefix: string;
}> = ({ segments, originTitle, testIdPrefix }) => {
  if (segments.length === 0) {
    return null;
  }

  return (
    <Breadcrumbs
      data-testid={`${testIdPrefix}-breadcrumbs`}
      separator={
        <ChevronRightIcon sx={{ fontSize: "1rem", color: "text.disabled" }} />
      }
      sx={{
        bgcolor: "transparent !important",
        background: "transparent !important",
        backgroundColor: "transparent !important",
        "& .MuiBreadcrumbs-ol": {
          background: "transparent !important",
          backgroundColor: "transparent !important",
        },
        "& .MuiBreadcrumbs-li": {
          lineHeight: 1.3,
          background: "transparent !important",
          backgroundColor: "transparent !important",
        },
        "& .MuiLink-root": {
          background: "transparent !important",
          backgroundColor: "transparent !important",
        },
        "& .MuiTypography-root": {
          background: "transparent !important",
          backgroundColor: "transparent !important",
        },
      }}
    >
      {segments.map((segment, index) => (
        <BreadcrumbLink
          key={segment.entityId}
          to={segment.href}
          type={segment.entityType}
          data-testid={`${testIdPrefix}-breadcrumb-${index}`}
        >
          {segment.title}
        </BreadcrumbLink>
      ))}
      <BreadcrumbLink
        isCurrentPage
        type={segments[segments.length - 1]?.entityType}
      >
        {originTitle}
      </BreadcrumbLink>
    </Breadcrumbs>
  );
};

export interface ActivityGraphLayoutProps extends ActivityGanttChartData {
  view?: ActivityGanttViewModeType;
  emptyMessage?: string;
  testIdPrefix?: string;
  conversationMessages?: ConversationMessageOverlay[];
  projectId?: string;
}

export const ActivityGraphLayout: React.FC<ActivityGraphLayoutProps> = ({
  parentTasks,
  currentWork,
  activeSessions,
  subtasks,
  reports,
  verificationRecommendations,
  blockingRelationships,
  breadcrumbs,
  planScope,
  timeContext: _timeContext,
  status: _status,
  view = ActivityGanttViewMode.Full,
  emptyMessage = "No related entities",
  testIdPrefix = "activity-gantt-layout",
  conversationMessages,
  projectId,
}) => {
  const pathService = usePathService();
  const chartData = useMemo<ActivityGanttChartData>(
    () => ({
      parentTasks,
      currentWork,
      activeSessions,
      subtasks,
      reports,
      verificationRecommendations,
      blockingRelationships,
      breadcrumbs,
      ...(planScope ? { planScope } : {}),
      timeContext: _timeContext,
      status: _status,
    }),
    [
      parentTasks,
      currentWork,
      activeSessions,
      subtasks,
      reports,
      verificationRecommendations,
      blockingRelationships,
      breadcrumbs,
      planScope,
      _timeContext,
      _status,
    ],
  );

  const resolvedBreadcrumbs = useMemo<ResolvedBreadcrumbSegment[]>(
    () =>
      breadcrumbs.map((segment) => ({
        ...segment,
        href: resolveActivityGraphEntityHref({
          entityId: segment.entityId,
          entityType: segment.entityType,
          projectId,
          planScope,
          pathService,
        }),
      })),
    [breadcrumbs, pathService, planScope, projectId],
  );

  const signalLookup = useMemo(
    () => buildSignalLookup(blockingRelationships),
    [blockingRelationships],
  );

  const allEntities = getAllEntities(chartData);

  if (allEntities.length === 0) {
    return (
      <Paper data-testid={testIdPrefix} sx={{ p: 1.5 }} variant="outlined">
        <Typography
          color="text.secondary"
          data-testid={`${testIdPrefix}-empty`}
          variant="body2"
        >
          {emptyMessage}
        </Typography>
      </Paper>
    );
  }

  const isMinimalGantt = view === ActivityGanttViewMode.MinimalGantt;
  const isCompact = view === ActivityGanttViewMode.Compact;

  if (isCompact) {
    const focalEntity =
      chartData.currentWork[0] ?? chartData.activeSessions[0] ?? null;
    if (!focalEntity) {
      return (
        <Paper data-testid={testIdPrefix} sx={{ p: 1.5 }} variant="outlined">
          <Typography
            color="text.secondary"
            data-testid={`${testIdPrefix}-empty`}
            variant="body2"
          >
            {emptyMessage}
          </Typography>
        </Paper>
      );
    }

    return (
      <Paper data-testid={testIdPrefix} sx={{ p: 1.5 }} variant="outlined">
        <ActivityGraphEntity
          emphasis
          entity={focalEntity}
          planScope={planScope}
          projectId={projectId}
          signals={signalLookup.get(focalEntity.id) ?? []}
          view={view}
        />
      </Paper>
    );
  }

  if (isMinimalGantt) {
    const centerOnlyChartData: ActivityGanttChartData = {
      ...chartData,
      parentTasks: [],
      subtasks: [],
      reports: [],
      verificationRecommendations: [],
    };

    const minimalOriginEntity =
      chartData.currentWork[0] ?? chartData.activeSessions[0] ?? null;
    const minimalOriginTitle = minimalOriginEntity?.title ?? "";

    const minimalLastBreadcrumb =
      resolvedBreadcrumbs[resolvedBreadcrumbs.length - 1];
    const isMinimalRedundant =
      minimalOriginEntity?.entityType === EntityType.Task &&
      minimalLastBreadcrumb?.entityId === minimalOriginEntity.entityId &&
      minimalLastBreadcrumb?.entityType === EntityType.Task;
    const minimalBreadcrumbs = isMinimalRedundant
      ? resolvedBreadcrumbs.slice(0, -1)
      : resolvedBreadcrumbs;
    const minimalDisplayTitle = isMinimalRedundant
      ? minimalLastBreadcrumb.title
      : minimalOriginTitle;

    return (
      <Box
        data-testid={testIdPrefix}
        sx={{ border: "none", background: "transparent" }}
      >
        <Stack spacing={1.5}>
          {minimalBreadcrumbs.length > 0 ? (
            <BreadcrumbTrail
              segments={minimalBreadcrumbs}
              originTitle={minimalDisplayTitle}
              testIdPrefix={testIdPrefix}
            />
          ) : null}
          <ActivityGraphCanvas
            chartData={centerOnlyChartData}
            conversationMessages={conversationMessages}
            projectId={projectId}
            signalLookup={signalLookup}
            testIdPrefix={testIdPrefix}
          />
        </Stack>
      </Box>
    );
  }

  const footerContent = FOOTER_LANES.map((role) =>
    renderFooterLane({
      laneRole: role,
      chartData,
      projectId,
      signalLookup,
      testIdPrefix,
    }),
  ).filter(Boolean);

  const originEntity =
    chartData.currentWork[0] ?? chartData.activeSessions[0] ?? null;
  const originTitle = originEntity?.title ?? "";

  // When the origin is a Task and the last breadcrumb is a PlanStep,
  // step and task are effectively the same — drop the redundant task entry
  // and promote the step to the "current" position.
  const lastBreadcrumb = resolvedBreadcrumbs[resolvedBreadcrumbs.length - 1];
  const isRedundantTaskBreadcrumb =
    originEntity?.entityType === EntityType.Task &&
    lastBreadcrumb?.entityId === originEntity.entityId &&
    lastBreadcrumb?.entityType === EntityType.Task;
  const displayBreadcrumbs = isRedundantTaskBreadcrumb
    ? resolvedBreadcrumbs.slice(0, -1)
    : resolvedBreadcrumbs;
  const displayOriginTitle = isRedundantTaskBreadcrumb
    ? lastBreadcrumb.title
    : originTitle;

  return (
    <Paper
      data-testid={testIdPrefix}
      sx={{ p: 1.5, border: "none", background: "transparent" }}
      variant="outlined"
    >
      <Stack spacing={1.5}>
        {displayBreadcrumbs.length > 0 ? (
          <BreadcrumbTrail
            segments={displayBreadcrumbs}
            originTitle={displayOriginTitle}
            testIdPrefix={testIdPrefix}
          />
        ) : null}

        <ActivityGraphCanvas
          chartData={chartData}
          conversationMessages={conversationMessages}
          projectId={projectId}
          signalLookup={signalLookup}
          testIdPrefix={testIdPrefix}
        />

        {footerContent.length > 0 ? (
          <Box
            data-testid={`${testIdPrefix}-footer`}
            sx={{
              display: "flex",
              flexDirection: "row",
              gap: 1.5,
              flexWrap: "wrap",
            }}
          >
            {footerContent}
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
};

const ActivityGraphCanvas: React.FC<{
  chartData: ActivityGanttChartData;
  conversationMessages?: ConversationMessageOverlay[];
  projectId?: string;
  signalLookup: Map<
    ActivityGanttEntityNode["id"],
    ActivityGanttRelationshipTypeType[]
  >;
  testIdPrefix: string;
}> = ({
  chartData,
  conversationMessages,
  projectId,
  signalLookup,
  testIdPrefix,
}) => {
  const theme = useTheme();
  const darkMode = theme.palette.mode === "dark";
  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const [measuredHeights, setMeasuredHeights] = useState<
    Record<string, number>
  >({});
  const [isMeasuring, setIsMeasuring] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);

  const measureWidth = useCallback(() => {
    const el = graphContainerRef.current;
    if (el) {
      setContainerWidth(el.getBoundingClientRect().width);
    }
  }, []);

  useEffect(() => {
    measureWidth();
    window.addEventListener("resize", measureWidth);
    return () => window.removeEventListener("resize", measureWidth);
  }, [measureWidth]);

  const graphData = useMemo(
    () =>
      buildActivityGraphNodes(chartData, signalLookup, {
        nodeHeights: isMeasuring ? undefined : measuredHeights,
        containerWidth: containerWidth > 0 ? containerWidth : undefined,
        conversationMessages,
        darkMode,
        projectId,
        planScope: chartData.planScope,
      }),
    [
      chartData,
      signalLookup,
      isMeasuring,
      measuredHeights,
      containerWidth,
      conversationMessages,
      darkMode,
      projectId,
    ],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(graphData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphData.edges);

  React.useEffect(() => {
    setNodes(graphData.nodes);
    setEdges(graphData.edges);
  }, [graphData, setNodes, setEdges]);

  React.useEffect(() => {
    setMeasuredHeights({});
    setIsMeasuring(true);
  }, [chartData, signalLookup]);

  useLayoutEffect(() => {
    if (!isMeasuring) return;
    const container = graphContainerRef.current;
    if (!container) return;

    const frame = requestAnimationFrame(() => {
      const nextHeights: Record<string, number> = {};
      const nodeElements =
        container.querySelectorAll<HTMLElement>(".react-flow__node");

      if (nodeElements.length === 0) {
        setIsMeasuring(false);
        return;
      }

      nodeElements.forEach((nodeEl) => {
        const nodeId = nodeEl.getAttribute("data-id");
        if (!nodeId) return;
        const height = Math.ceil(nodeEl.getBoundingClientRect().height);
        if (height > 0) {
          nextHeights[nodeId] = height;
        }
      });

      if (Object.keys(nextHeights).length > 0) {
        setMeasuredHeights(nextHeights);
        setIsMeasuring(false);
      } else {
        setIsMeasuring(false);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [isMeasuring, nodes]);

  const containerHeight = Math.max(graphData.totalHeight + 32, 120);

  return (
    <Box
      data-testid={`${testIdPrefix}-graph`}
      ref={graphContainerRef}
      sx={{
        height: containerHeight,
        visibility: isMeasuring ? "hidden" : "visible",
        "& .react-flow__node": {
          cursor: "default",
        },
        ...(darkMode
          ? {
              "& .react-flow__edge path": {
                stroke: "rgba(255, 255, 255, 0.4)",
              },
            }
          : {}),
        "& .react-flow__pane": {
          cursor: "default",
        },
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      />
    </Box>
  );
};
