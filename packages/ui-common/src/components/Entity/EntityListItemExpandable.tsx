import {
  Alert,
  Box,
  CircularProgress,
  Collapse,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme as useMuiTheme } from "@mui/material/styles";
import React, { useCallback, useState } from "react";
import { EntityListItem, type EntityListItemProps } from "./EntityListItem";

export interface EntityListItemExpandableProps<T> extends EntityListItemProps {
  hasChildren?: boolean;
  childrenCount?: number;
  isExpanded?: boolean;
  onToggleExpand?: (expanded: boolean) => void;
  fetchChildren?: () => Promise<T[]>;
  renderChildren?: (children: T[]) => React.ReactNode;
  childrenLoading?: boolean;
  childrenError?: Error | null;
  maxNestingLevel?: number;
}

export const EntityListItemExpandable = <T,>({
  hasChildren,
  childrenCount,
  isExpanded: controlledExpanded,
  onToggleExpand,
  fetchChildren,
  renderChildren,
  nestingLevel = 0,
  maxNestingLevel = 5,
  ...entityListItemProps
}: EntityListItemExpandableProps<T>): React.ReactElement => {
  const theme = useMuiTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [localExpanded, setLocalExpanded] = useState(false);
  const [children, setChildren] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : localExpanded;

  const handleToggle = useCallback(async () => {
    const newExpanded = !expanded;

    if (isControlled) {
      onToggleExpand?.(newExpanded);
    } else {
      setLocalExpanded(newExpanded);
    }

    // Lazy load children on first expand
    if (newExpanded && children.length === 0 && fetchChildren) {
      setLoading(true);
      try {
        const data = await fetchChildren();
        setChildren(data);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    }
  }, [expanded, isControlled, onToggleExpand, children.length, fetchChildren]);

  const shouldShowExpandButton = hasChildren && nestingLevel < maxNestingLevel;

  return (
    <>
      <EntityListItem
        {...entityListItemProps}
        nestingLevel={nestingLevel}
        expandButton={
          shouldShowExpandButton
            ? {
                expanded,
                onToggle: handleToggle,
                hasChildren: true,
              }
            : undefined
        }
      />

      {hasChildren && expanded && nestingLevel < maxNestingLevel && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <Box
            sx={{
              ml: isMobile ? 1.5 : 4,
              minWidth: 0,
              maxWidth: "100%",
              boxSizing: "border-box",
            }}
          >
            {loading && <CircularProgress size={24} sx={{ m: 2 }} />}
            {error && (
              <Alert severity="error" sx={{ m: 2 }}>
                {error.message}
              </Alert>
            )}
            {!loading && !error && children.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                No children found
              </Typography>
            )}
            {!loading && !error && renderChildren?.(children)}
          </Box>
        </Collapse>
      )}
    </>
  );
};
