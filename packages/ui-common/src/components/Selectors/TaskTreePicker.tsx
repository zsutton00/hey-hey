import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ClearIcon from "@mui/icons-material/Clear";
import {
  Box,
  CircularProgress,
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Popover,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { TaskResponseDto } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import {
  useFeatureHierarchy,
  useFeatureLookup,
  type FeatureLookupEntry,
  type FeatureHierarchyNode,
} from "../../data/hooks/useFeatureHierarchy";
import { useFeatureDocumentContent } from "../../data/hooks/useFeatureDocumentContent";
import { useWorkItem } from "../../data/hooks/useWorkItem";

const SelectedTaskName: React.FC<{
  organizationId: string;
  projectId: string;
  taskId: string;
}> = ({ organizationId, projectId, taskId }) => {
  const lookup = useFeatureLookup(organizationId, projectId);
  const feature = lookup.get(taskId);
  const { workItem } = useWorkItem(organizationId, "task", taskId, {
    projectId,
    enabled: !lookup.isLoading && !feature,
  });
  return <>{feature?.name ?? workItem?.name ?? "…"}</>;
};

type PickerTask = TaskResponseDto | FeatureHierarchyNode["feature"];

type NodeChildrenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; children: PickerTask[] }
  | { status: "error" };

function isFeatureFirst(taskType?: string): boolean {
  return taskType !== "STANDARD" && taskType !== "BUG";
}

async function fetchChildren(
  organizationId: string,
  projectId: string,
  parentTaskId: string | null,
  taskType?: string
): Promise<TaskResponseDto[]> {
  const res = await unifiedApiClient.getTasks({
    organizationId,
    projectId,
    parentTaskId,
    type: taskType,
  });
  const items = res.data.data ?? [];
  return items.slice().sort((a, b) => {
    const aIsFeature = a.type === "FEATURE" ? 0 : 1;
    const bIsFeature = b.type === "FEATURE" ? 0 : 1;
    if (aIsFeature !== bIsFeature) return aIsFeature - bIsFeature;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

async function loadAncestorChain(
  organizationId: string,
  projectId: string,
  taskId: string,
  taskType: string | undefined,
  getFeature: (id: string) => FeatureLookupEntry | undefined,
  nodes: ReadonlyMap<string, FeatureHierarchyNode>
): Promise<{
  chain: string[];
  childrenByParent: Map<string | "root", PickerTask[]>;
}> {
  const chain: string[] = [];
  const childrenByParent = new Map<string | "root", PickerTask[]>();

  let currentId: string | undefined = taskId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    try {
      const cached = getFeature(currentId);
      const task: FeatureLookupEntry | TaskResponseDto | undefined =
        cached ??
        (
          await unifiedApiClient.getTask({
            organizationId,
            projectId,
            taskId: currentId,
          })
        ).data.data;
      if (!task) break;
      chain.unshift(currentId);
      currentId = task.parentTaskId ?? undefined;
    } catch {
      break;
    }
  }

  const parentIds =
    chain.length > 0
      ? [undefined as string | undefined, ...chain.slice(0, -1)]
      : [];

  await Promise.all(
    parentIds.map(async (parentId) => {
      const key = parentId ?? "root";
      if (parentId === undefined && isFeatureFirst(taskType)) return;
      if (parentId && taskType === "FEATURE" && nodes.has(parentId)) {
        childrenByParent.set(
          key,
          nodes.get(parentId)!.children.map((node) => node.feature)
        );
        return;
      }
      const fetchType = taskType;
      try {
        const children = await fetchChildren(
          organizationId,
          projectId,
          parentId ?? null,
          fetchType
        );
        childrenByParent.set(key, children);
      } catch {
        // non-critical: tree will lazy-load on expand
      }
    })
  );

  return { chain, childrenByParent };
}

const TreeNode: React.FC<{
  task: PickerTask;
  level: number;
  selectedId: string | null;
  onSelect: (task: TaskResponseDto) => void;
  organizationId: string;
  projectId: string;
  taskType?: string;
  ancestorExpandedIds: Set<string>;
  preloadedChildren: Map<string | "root", PickerTask[]>;
}> = ({
  task,
  level,
  selectedId,
  onSelect,
  organizationId,
  projectId,
  taskType,
  ancestorExpandedIds,
  preloadedChildren,
}) => {
  const isAncestor = ancestorExpandedIds.has(task.id);
  const cachedChildren = preloadedChildren.get(task.id);

  const [expanded, setExpanded] = useState(isAncestor);
  const [childState, setChildState] = useState<NodeChildrenState>(
    cachedChildren
      ? { status: "loaded", children: cachedChildren }
      : { status: "idle" }
  );

  const hierarchy = useFeatureHierarchy(organizationId, projectId);
  const node = hierarchy.nodes.get(task.id);
  const { entries } = useFeatureDocumentContent(
    organizationId,
    projectId,
    node ? [task.id] : [],
    undefined,
    "metadata"
  );
  const metadata = entries.get(task.id)?.data;
  const hasChildren =
    node && taskType === "FEATURE"
      ? node.children.length > 0
      : (node?.children.length ?? 0) > 0 ||
        (metadata?.childCounts?.total ??
          ("childCounts" in task ? task.childCounts?.total : undefined) ??
          0) > 0;
  useEffect(() => {
    if (isAncestor) setExpanded(true);
    if (cachedChildren)
      setChildState({ status: "loaded", children: cachedChildren });
  }, [isAncestor, cachedChildren]);

  const handleExpandClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!hasChildren) return;
      setExpanded((previous) => !previous);
      if (
        !expanded &&
        childState.status === "idle" &&
        !(taskType === "FEATURE" && node)
      ) {
        setChildState({ status: "loading" });
        try {
          const children = await fetchChildren(
            organizationId,
            projectId,
            task.id,
            taskType
          );
          setChildState({ status: "loaded", children });
        } catch {
          setChildState({ status: "error" });
        }
      }
    },
    [
      expanded,
      childState.status,
      organizationId,
      projectId,
      task.id,
      taskType,
      hasChildren,
      node,
    ]
  );

  const isLoading = childState.status === "loading";
  const fetchedChildren =
    childState.status === "loaded" ? childState.children : null;
  const children = node
    ? [
        ...node.children.map((child) => child.feature),
        ...(fetchedChildren ?? []).filter((child) => child.type !== "FEATURE"),
      ]
    : fetchedChildren;

  return (
    <Box>
      <ListItemButton
        data-testid="task-tree-picker-option"
        data-task-id={task.id}
        sx={{ pl: 1 + level * 2.5 }}
        selected={selectedId === task.id}
        onClick={() => {
          if (metadata) onSelect(metadata);
          else if ("status" in task) onSelect(task);
        }}
        dense
      >
        <Box
          component="span"
          sx={{
            mr: 0.5,
            display: "flex",
            alignItems: "center",
            width: 20,
          }}
          role={hasChildren ? "button" : undefined}
          aria-label={hasChildren ? `Expand ${task.name}` : undefined}
          data-testid="task-tree-picker-expand"
          onClick={hasChildren ? handleExpandClick : undefined}
        >
          {isLoading ? (
            <CircularProgress size={14} sx={{ m: "3px" }} />
          ) : hasChildren ? (
            <ChevronRightIcon
              sx={{
                fontSize: 18,
                transition: "transform 0.15s",
                transform: expanded ? "rotate(90deg)" : "none",
                color: "text.secondary",
              }}
            />
          ) : null}
        </Box>
        <ListItemText
          primary={task.name || "Untitled"}
          secondary={
            task.type === "FEATURE"
              ? "Feature"
              : task.type === "BUG"
              ? "Bug"
              : "Task"
          }
          primaryTypographyProps={{ variant: "body2" }}
          secondaryTypographyProps={{ variant: "caption" }}
        />
      </ListItemButton>
      <Collapse in={expanded} unmountOnExit>
        {children && children.length > 0
          ? children.map((child) => (
              <TreeNode
                key={child.id}
                task={child}
                level={level + 1}
                selectedId={selectedId}
                onSelect={onSelect}
                organizationId={organizationId}
                projectId={projectId}
                taskType={taskType}
                ancestorExpandedIds={ancestorExpandedIds}
                preloadedChildren={preloadedChildren}
              />
            ))
          : children !== null && (
              <Box sx={{ pl: 3 + level * 2.5, py: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  No children
                </Typography>
              </Box>
            )}
        {childState.status === "error" && (
          <Box sx={{ pl: 3 + level * 2.5, py: 0.5 }}>
            <Typography variant="caption" color="error">
              Failed to load
            </Typography>
          </Box>
        )}
      </Collapse>
    </Box>
  );
};

export interface TaskTreePickerProps {
  organizationId: string;
  projectId: string;
  label?: string;
  value: string | null;
  onChange: (taskId: string | null, task?: TaskResponseDto) => void;
  disabled?: boolean;
  includeNone?: boolean;
  taskType?: string;
}

export const TaskTreePicker: React.FC<TaskTreePickerProps> = ({
  organizationId,
  projectId,
  label = "Parent",
  value,
  onChange,
  disabled = false,
  includeNone = false,
  taskType,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [rootTasks, setRootTasks] = useState<PickerTask[] | null>(null);
  const [isLoadingNonFeatureRoot, setIsLoadingRoot] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskResponseDto | null>(
    null
  );
  const [ancestorExpandedIds, setAncestorExpandedIds] = useState<Set<string>>(
    new Set()
  );
  const [preloadedChildren, setPreloadedChildren] = useState<
    Map<string | "root", PickerTask[]>
  >(new Map());
  const ancestorLoadedForRef = useRef<string | null>(null);
  const featureFirst = isFeatureFirst(taskType);
  const hierarchy = useFeatureHierarchy(organizationId, projectId);
  const lookup = useFeatureLookup(organizationId, projectId);
  const isLoadingRoot = featureFirst
    ? hierarchy.isLoading
    : isLoadingNonFeatureRoot;
  const visibleRoots = featureFirst
    ? hierarchy.roots.map((node) => node.feature)
    : rootTasks;

  useEffect(() => {
    if (value === null) setSelectedTask(null);
    else if (selectedTask && selectedTask.id !== value) setSelectedTask(null);
  }, [value, selectedTask]);

  useEffect(() => {
    ancestorLoadedForRef.current = null;
  }, [organizationId, projectId, taskType]);

  useEffect(() => {
    if (lookup.isLoading || !value || ancestorLoadedForRef.current === value)
      return;
    ancestorLoadedForRef.current = value;

    let cancelled = false;
    loadAncestorChain(
      organizationId,
      projectId,
      value,
      taskType,
      lookup.get,
      hierarchy.nodes
    )
      .then(({ chain, childrenByParent }) => {
        if (cancelled) return;
        setAncestorExpandedIds(new Set(chain.slice(0, -1)));
        setPreloadedChildren(childrenByParent);
        if (childrenByParent.has("root")) {
          setRootTasks(childrenByParent.get("root")!);
        }
      })
      .catch(() => {
        // Ancestor preload is non-critical; tree still works via lazy load
      });
    return () => {
      cancelled = true;
      if (ancestorLoadedForRef.current === value)
        ancestorLoadedForRef.current = null;
    };
  }, [
    value,
    organizationId,
    projectId,
    taskType,
    lookup.isLoading,
    lookup.get,
    hierarchy.nodes,
  ]);

  const loadRoot = useCallback(async () => {
    if (featureFirst || rootTasks !== null) return;
    setIsLoadingRoot(true);
    try {
      const children = await fetchChildren(
        organizationId,
        projectId,
        null,
        taskType
      );
      setRootTasks(children);
    } catch {
      setRootTasks([]);
    } finally {
      setIsLoadingRoot(false);
    }
  }, [rootTasks, organizationId, projectId, taskType, featureFirst]);

  const handleOpen = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      setAnchorEl(e.currentTarget);
      loadRoot();
    },
    [loadRoot]
  );

  const handleClose = useCallback(() => setAnchorEl(null), []);

  const handleSelect = useCallback(
    (task: TaskResponseDto) => {
      setSelectedTask(task);
      onChange(task.id, task);
      handleClose();
    },
    [onChange, handleClose]
  );

  const handleNone = useCallback(() => {
    setSelectedTask(null);
    onChange(null);
    handleClose();
  }, [onChange, handleClose]);

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedTask(null);
      onChange(null);
    },
    [onChange]
  );

  const open = Boolean(anchorEl);

  const hasResolvableLabel = value && !selectedTask;

  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ whiteSpace: "nowrap" }}
        >
          {label}:
        </Typography>
        <Box
          data-testid="task-tree-picker-trigger"
          onClick={disabled ? undefined : handleOpen}
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            border: "1px solid",
            borderColor: open ? "primary.main" : "divider",
            borderRadius: 1,
            px: 1,
            py: 0.5,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.5 : 1,
            minHeight: 32,
            "&:hover": disabled ? {} : { borderColor: "text.primary" },
          }}
        >
          <Typography
            variant="body2"
            color={value ? "text.primary" : "text.secondary"}
            sx={{ flex: 1 }}
          >
            {value ? (
              selectedTask ? (
                selectedTask.name || "Untitled"
              ) : hasResolvableLabel ? (
                <SelectedTaskName
                  organizationId={organizationId}
                  projectId={projectId}
                  taskId={value}
                />
              ) : (
                "…"
              )
            ) : (
              "None"
            )}
          </Typography>
          {value && !disabled && (
            <IconButton
              size="small"
              onClick={handleClear}
              sx={{ ml: 0.5, p: 0.25 }}
            >
              <ClearIcon sx={{ fontSize: 14 }} />
            </IconButton>
          )}
        </Box>
      </Box>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        PaperProps={{ sx: { width: 360, maxHeight: 420, overflow: "auto" } }}
      >
        <List dense disablePadding>
          {includeNone && (
            <ListItemButton
              onClick={handleNone}
              selected={value === null}
              dense
            >
              <ListItemText
                primary="None"
                primaryTypographyProps={{
                  variant: "body2",
                  color: "text.secondary",
                }}
              />
            </ListItemButton>
          )}
          {isLoadingRoot ? (
            <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
              <CircularProgress size={20} />
            </Box>
          ) : (
            visibleRoots?.map((task) => (
              <TreeNode
                key={task.id}
                task={task}
                level={0}
                selectedId={value}
                onSelect={handleSelect}
                organizationId={organizationId}
                projectId={projectId}
                taskType={taskType}
                ancestorExpandedIds={ancestorExpandedIds}
                preloadedChildren={preloadedChildren}
              />
            ))
          )}
          {visibleRoots?.length === 0 && !isLoadingRoot && (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {featureFirst && hierarchy.error
                  ? "Unable to load feature hierarchy"
                  : "No tasks found"}
              </Typography>
            </Box>
          )}
        </List>
      </Popover>
    </>
  );
};
