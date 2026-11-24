import { Box, Skeleton, Stack, Typography } from "@mui/material";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { useWorkItemGraph } from "../../data/hooks/useWorkItemGraph";
import { getDiagramElementMetadata } from "./diagramElementMetadata";
import {
  WorkflowGraphDirectEntityLinkStrip,
  getDiagramRoleIcon,
  getDirectEntityLinksByNodeId,
} from "./diagramElementDirectLinks";
import { MarkdownRenderer } from "./MarkdownRenderer";

/** Link icons shown on a compact card before the rest collapse into `+N`. */
const MAX_VISIBLE_LINKS = 2;

const DIAGRAM_ELEMENT_TYPE = "DIAGRAM_ELEMENT";
const ARCHIVED_STATUS = "ARCHIVED";

/** Keeps a title from breaking the mention token it is embedded in. */
const mentionSafe = (title: string): string => title.replace(/[|[\]\n]/g, " ");

interface DiagramElementReferenceCardProps {
  organizationId: string;
  projectId: string;
  diagramElementId: string;
}

/**
 * Compact inline presentation of one Diagram Element: role icon, name, the
 * Diagram it is in, and its directly linked entities. The element is read
 * live, so a reference that no longer resolves (archived, deleted, not a
 * Diagram Element, or in an archived Diagram) renders nothing and never
 * affects its siblings.
 */
export const DiagramElementReferenceCard = ({
  organizationId,
  projectId,
  diagramElementId,
}: DiagramElementReferenceCardProps) => {
  const element = useWorkItem(organizationId, "task", diagramElementId, {
    projectId,
  });
  const elementItem = element.workItem;
  const diagramId = elementItem?.parentTaskId;
  const diagram = useWorkItem(organizationId, "task", diagramId ?? "", {
    projectId,
    enabled: Boolean(diagramId),
  });
  const graph = useWorkItemGraph(
    organizationId,
    projectId,
    diagramId ?? undefined,
    {
      enabled: Boolean(diagramId),
    },
  );

  const pending =
    !element.isFetched ||
    (Boolean(diagramId) && (!diagram.isFetched || !graph.isFetched));
  if (pending) {
    return (
      <Skeleton
        variant="rounded"
        height={44}
        data-testid="diagram-element-reference-loading"
      />
    );
  }

  const diagramItem = diagram.workItem;
  const resolved =
    elementItem &&
    diagramItem &&
    elementItem.type.toUpperCase() === DIAGRAM_ELEMENT_TYPE &&
    elementItem.status !== ARCHIVED_STATUS &&
    diagramItem.status !== ARCHIVED_STATUS;
  if (!resolved) {
    return null;
  }

  const role = getDiagramElementMetadata(elementItem)?.role ?? "GENERIC";
  const RoleIcon = getDiagramRoleIcon(role);
  const allLinks =
    getDirectEntityLinksByNodeId(
      [elementItem],
      graph.data?.relationships ?? [],
      [],
      projectId,
    ).get(elementItem.id) ?? [];
  const visibleLinks = allLinks.slice(0, MAX_VISIBLE_LINKS);
  const hiddenCount = allLinks.length - visibleLinks.length;

  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="flex-start"
      data-testid="diagram-element-reference"
      data-diagram-element-id={elementItem.id}
      sx={{ minWidth: 0 }}
    >
      <RoleIcon
        aria-hidden
        fontSize="small"
        sx={{ color: "text.secondary", mt: 0.25 }}
        data-testid="diagram-element-reference-role-icon"
        data-role={role}
      />
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Stack
          direction="row"
          spacing={0.75}
          alignItems="baseline"
          flexWrap="wrap"
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {elementItem.name}
          </Typography>
          <Typography
            component="div"
            variant="caption"
            color="text.secondary"
            sx={{ display: "flex", gap: 0.5, alignItems: "baseline" }}
          >
            in
            <MarkdownRenderer
              mentionMode="minimal"
              sx={{ fontSize: "0.75rem", display: "inline" }}
            >
              {`@[task:${diagramItem.id}|${mentionSafe(diagramItem.name)}]`}
            </MarkdownRenderer>
          </Typography>
        </Stack>
        {visibleLinks.length > 0 ? (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <WorkflowGraphDirectEntityLinkStrip
              links={visibleLinks}
              organizationId={organizationId}
              projectId={projectId}
              layout="inline"
            />
            {hiddenCount > 0 ? (
              <Box
                component="span"
                data-testid="diagram-element-reference-more-links"
                sx={{ typography: "caption", color: "text.secondary" }}
              >
                +{hiddenCount}
              </Box>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Stack>
  );
};
