import {
  Box,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from "@mui/material";
import React from "react";
import { useNavigate } from "react-router-dom";
import { useModalService } from "../../../contexts/ModalService";
import { navigateToEntity } from "../../WebUtils/navigateToEntity";
import type { FieldComponentProps } from "./types";

interface SearchResultItem {
  entityType: string;
  entityId: string;
  title: string;
  reason?: string;
  snippet?: string;
}

const getSearchResultTitle = (result: SearchResultItem): string => {
  const title = result.title.trim();
  if (title) {
    return title;
  }

  return result.entityType.trim().toLowerCase() === "message"
    ? "Untitled message"
    : "Untitled entity";
};

const isSearchResultItem = (value: unknown): value is SearchResultItem =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as SearchResultItem).entityType === "string" &&
  typeof (value as SearchResultItem).entityId === "string" &&
  typeof (value as SearchResultItem).title === "string";

const extractResults = (payload: unknown): SearchResultItem[] => {
  if (Array.isArray(payload)) {
    return payload.filter(isSearchResultItem);
  }
  if (
    typeof payload === "object" &&
    payload !== null &&
    Array.isArray((payload as { results?: unknown }).results)
  ) {
    return (payload as { results: unknown[] }).results.filter(
      isSearchResultItem
    );
  }
  return [];
};

export const AgentSearchResultsField: React.FC<FieldComponentProps> = ({
  config,
  context,
}) => {
  const navigate = useNavigate();
  const modalService = useModalService();
  const results = extractResults(config.payload);

  if (results.length === 0) {
    return null;
  }

  return (
    <Box data-testid="agent-search-results-field" data-field={config.field}>
      <List disablePadding>
        {results.map((result) => {
          const entityType = result.entityType.toLowerCase().replace(/ /g, "_");
          const secondary = result.reason ?? result.snippet;
          const title = getSearchResultTitle(result);

          return (
            <ListItemButton
              key={result.entityId}
              onClick={() => {
                void navigateToEntity({
                  projectId: context.projectId,
                  entity: {
                    id: result.entityId,
                    type: entityType,
                    name: title,
                  },
                  navigate,
                });
                modalService?.close();
              }}
              sx={{ py: 1, borderRadius: 1 }}
              data-testid="agent-search-results-result"
              data-entity-id={result.entityId}
            >
              <ListItemText
                primary={title}
                secondary={
                  secondary ? (
                    <Typography
                      component="span"
                      variant="caption"
                      color="textSecondary"
                    >
                      {secondary}
                    </Typography>
                  ) : null
                }
              />
              <Chip
                label={result.entityType}
                size="small"
                variant="outlined"
                sx={{ ml: 1, flexShrink: 0 }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
};
