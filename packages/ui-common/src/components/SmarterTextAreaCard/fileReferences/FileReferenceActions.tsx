import { Box, ListItemText, Menu, MenuItem } from "@mui/material";
import {
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { FileTouchHistoryPanel } from "../../FileTouchHistory";
import type { FileReferenceValueV1 } from "./types";

export interface FileReferenceActionContext {
  organizationId: string;
  projectId: string;
}

export type FileReferenceEditorAction =
  | { status: "available"; onSelect: () => void }
  | { status: "unavailable" };

export interface FileReferenceActionsProps {
  children: ReactNode;
  context: FileReferenceActionContext;
  editorAction: FileReferenceEditorAction;
  value: FileReferenceValueV1;
}

interface FileReferenceMenuPosition {
  left: number;
  top: number;
}

export const FileReferenceActions = ({
  children,
  context,
  editorAction,
  value,
}: FileReferenceActionsProps) => {
  const [menuPosition, setMenuPosition] =
    useState<FileReferenceMenuPosition | null>(null);
  const [isTaskHistoryOpen, setIsTaskHistoryOpen] = useState(false);

  const handleContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuPosition({ left: event.clientX, top: event.clientY });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || event.target !== event.currentTarget) return;

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({
      left: rect.left + rect.width / 2,
      top: rect.top + rect.height / 2,
    });
  };

  const openTaskHistory = () => {
    setMenuPosition(null);
    setIsTaskHistoryOpen(true);
  };

  const openEditor = () => {
    if (editorAction.status !== "available") return;
    setMenuPosition(null);
    editorAction.onSelect();
  };

  return (
    <>
      <Box
        component="span"
        role="group"
        tabIndex={0}
        aria-label={`Actions for ${value.serviceName}/${value.normalizedPath}`}
        aria-haspopup="menu"
        aria-expanded={menuPosition !== null}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        data-testid="file-reference-actions"
        sx={{
          cursor: "context-menu",
          outline: "none",
          "&:focus-visible": {
            boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}`,
          },
        }}
      >
        {children}
      </Box>
      <Menu
        open={menuPosition !== null}
        onClose={() => setMenuPosition(null)}
        anchorReference="anchorPosition"
        anchorPosition={menuPosition ?? undefined}
        data-testid="file-reference-context-menu"
      >
        {editorAction.status === "available" ? (
          <MenuItem
            onClick={openEditor}
            data-testid="file-reference-menu-go-to-file"
          >
            <ListItemText>Go to file</ListItemText>
          </MenuItem>
        ) : null}
        <MenuItem
          onClick={openTaskHistory}
          data-testid="file-reference-menu-show-tasks"
        >
          <ListItemText>Show Tasks</ListItemText>
        </MenuItem>
      </Menu>
      <FileTouchHistoryPanel
        open={isTaskHistoryOpen}
        onClose={() => setIsTaskHistoryOpen(false)}
        organizationId={context.organizationId}
        projectId={context.projectId}
        serviceId={value.serviceId}
        normalizedPath={value.normalizedPath}
      />
    </>
  );
};
