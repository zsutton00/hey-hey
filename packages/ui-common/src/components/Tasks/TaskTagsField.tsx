import {
  Autocomplete,
  Box,
  Chip,
  CircularProgress,
  TextField,
} from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Tag } from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { KEYS } from "../../i18n/keys";

export interface TaskTagsFieldProps {
  value: string[];
  onChange: (tags: string[]) => void;
  organizationId: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
}

interface OrganizationTag {
  id: string;
  name: string;
  count?: number;
  description?: string | null;
  color?: string | null;
}

export const TaskTagsField: React.FC<TaskTagsFieldProps> = ({
  value = [],
  onChange,
  organizationId,
  label,
  placeholder,
  disabled = false,
  error = false,
  helperText,
}) => {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [availableTags, setAvailableTags] = useState<OrganizationTag[]>([]);
  const [allTags, setAllTags] = useState<OrganizationTag[]>([]); // Cache for all tags
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Load initial tags when component mounts or organizationId changes
  useEffect(() => {
    if (!organizationId) {
      return;
    }

    setAvailableTags([]);
    setAllTags([]);
    setIsLoading(true);

    platformClient
      .listTags({ organizationId: organizationId, limit: 10 })
      .then((response) => {
        const tags = response.data.data || [];

        const organizationTags = tags.map((tag: Tag) => ({
          id: tag.id,
          name: tag.name,
          description: tag.description,
          color: tag.color,
        }));

        setAllTags(organizationTags);
        setAvailableTags(organizationTags);
      })
      .catch(() => {
        setAvailableTags([]);
        setAllTags([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [organizationId]);

  // Handle search when input value changes
  useEffect(() => {
    if (!organizationId) return;

    // Clear any existing timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // If no input, restore cached tags
    if (!inputValue.trim()) {
      setAvailableTags(allTags);
      setIsSearching(false);
      return;
    }

    // Set new timeout for debounced search
    debounceRef.current = setTimeout(() => {
      setIsSearching(true);
      platformClient
        .listTags({
          organizationId: organizationId,
          search: inputValue.trim(),
          limit: 10,
        })
        .then((response) => {
          const tags = (response as unknown as { data: Tag[] }).data || [];

          const organizationTags = tags.map((tag: Tag) => ({
            id: tag.id,
            name: tag.name,
            description: tag.description,
            color: tag.color,
          }));

          setAvailableTags(organizationTags);
        })
        .catch(() => {
          setAvailableTags([]);
        })
        .finally(() => {
          setIsSearching(false);
        });
    }, 300);

    // Cleanup timeout
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [inputValue, organizationId, allTags]);

  // Filter out already selected tags and map to tag names
  const filteredOptions = availableTags
    .filter((tag) => !value.includes(tag.name))
    .map((tag) => tag.name);

  // Add current input as an option if it's not empty and not already in the list
  const options =
    inputValue.trim() &&
    !filteredOptions.includes(inputValue.trim()) &&
    !value.includes(inputValue.trim())
      ? [...filteredOptions, inputValue.trim()]
      : filteredOptions;

  const handleTagAdd = useCallback(
    (newTag: string | null) => {
      if (newTag && newTag.trim() && !value.includes(newTag.trim())) {
        onChange([...value, newTag.trim()]);
      }
      setInputValue("");
    },
    [value, onChange]
  );

  const handleTagRemove = useCallback(
    (tagToRemove: string) => {
      onChange(value.filter((tag) => tag !== tagToRemove));
    },
    [value, onChange]
  );

  const handleInputChange = useCallback(
    (_event: React.SyntheticEvent, newInputValue: string) => {
      setInputValue(newInputValue);
    },
    []
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" && inputValue.trim()) {
        event.preventDefault();
        handleTagAdd(inputValue.trim());
      }
    },
    [inputValue, handleTagAdd]
  );

  return (
    <Box>
      <Autocomplete
        multiple={false}
        options={options}
        value={null}
        inputValue={inputValue}
        onInputChange={handleInputChange}
        onChange={(_event, newValue) => {
          handleTagAdd(newValue);
        }}
        loading={isLoading || isSearching}
        disabled={disabled}
        freeSolo
        clearOnBlur={false}
        selectOnFocus
        handleHomeEndKeys
        renderInput={(params) => (
          <TextField
            {...params}
            label={label || t(KEYS.tasks.form.tags)}
            placeholder={placeholder || t(KEYS.tasks.form.tagsPlaceholder)}
            error={error}
            helperText={helperText}
            onKeyDown={handleKeyDown}
            slotProps={{
              input: {
                ...params.InputProps,
                endAdornment: (
                  <>
                    {isLoading || isSearching ? (
                      <CircularProgress color="inherit" size={20} />
                    ) : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              },
            }}
          />
        )}
        renderOption={(props, option) => (
          <Box component="li" {...props} key={option}>
            {option}
          </Box>
        )}
      />

      {value.length > 0 && (
        <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {value.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              onDelete={() => handleTagRemove(tag)}
              disabled={disabled}
              size="small"
              color="primary"
              sx={(theme) => ({
                backgroundColor: theme.palette.actionable.main,
                color: theme.palette.actionable.contrastText,
                "&:hover": {
                  backgroundColor: theme.palette.actionable.dark,
                },
                "& .MuiChip-deleteIcon": {
                  color: theme.palette.actionable.contrastText,
                  "&:hover": {
                    color: theme.palette.actionable.contrastText,
                  },
                },
              })}
            />
          ))}
        </Box>
      )}
    </Box>
  );
};

export default TaskTagsField;
