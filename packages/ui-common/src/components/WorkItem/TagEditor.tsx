import React, { useState, useCallback } from "react";
import { Box, Chip, TextField, Typography, IconButton } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";

interface TagEditorProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  disabled?: boolean;
  maxTags?: number;
  placeholder?: string;
}

export const TagEditor: React.FC<TagEditorProps> = ({
  tags = [],
  onTagsChange,
  disabled = false,
  maxTags = 10,
  placeholder = "Add a tag...",
}) => {
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(event.target.value);
      if (error) setError(null);
    },
    [error]
  );

  const handleAddTag = useCallback(() => {
    const trimmedValue = inputValue.trim();

    if (!trimmedValue) {
      setError("Tag cannot be empty");
      return;
    }

    if (trimmedValue.length > 50) {
      setError("Tag must be 50 characters or less");
      return;
    }

    if (tags.includes(trimmedValue)) {
      setError("Tag already exists");
      return;
    }

    if (tags.length >= maxTags) {
      setError(`Cannot add more than ${maxTags} tags`);
      return;
    }

    const newTags = [...tags, trimmedValue];
    onTagsChange(newTags);
    setInputValue("");
    setError(null);
  }, [inputValue, tags, onTagsChange, maxTags]);

  const handleRemoveTag = useCallback(
    (tagToRemove: string) => {
      const newTags = tags.filter((tag) => tag !== tagToRemove);
      onTagsChange(newTags);
    },
    [tags, onTagsChange]
  );

  const handleKeyPress = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleAddTag();
      }
    },
    [handleAddTag]
  );

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={600}>
          Tags
        </Typography>
        <Typography variant="caption" color="text.secondary">
          ({tags.length}/{maxTags})
        </Typography>
      </Box>

      {/* Tags and Input in same container */}
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: 1,
          alignItems: "flex-start",
        }}
      >
        {/* Current Tags */}
        {tags.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontStyle: "italic", alignSelf: "center" }}
          >
            No tags added yet
          </Typography>
        ) : (
          tags.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              size="medium"
              onDelete={disabled ? undefined : () => handleRemoveTag(tag)}
              sx={{
                "& .MuiChip-deleteIcon": {
                  fontSize: "16px",
                },
              }}
            />
          ))
        )}

        {/* Add Tag Input - inline with tags */}
        {!disabled && tags.length < maxTags && (
          <>
            <TextField
              size="small"
              value={inputValue}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder={placeholder}
              error={!!error}
              sx={{
                width: 150,
                minWidth: 150,
              }}
              inputProps={{
                maxLength: 50,
              }}
            />
            <IconButton
              onClick={handleAddTag}
              disabled={!inputValue.trim()}
              size="small"
            >
              <AddIcon color="primary" />
            </IconButton>
          </>
        )}
      </Box>

      {/* Error message below if there is one */}
      {error && (
        <Typography
          variant="caption"
          color="error"
          sx={{ mt: 1, display: "block" }}
        >
          {error}
        </Typography>
      )}

      {disabled && tags.length === 0 && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontStyle: "italic" }}
        >
          No tags
        </Typography>
      )}
    </Box>
  );
};
