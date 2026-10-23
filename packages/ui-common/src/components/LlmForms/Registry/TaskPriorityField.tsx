import {
  Box,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import isObject from "lodash/isObject.js";
import React, { useEffect, useState } from "react";
import type {
  TaskPrioritySystemMessageData,
  TaskPrioritySystemMessageDataAllOfPriorityQueue,
} from "../../../api";
import type { FieldComponentProps } from "./types";

interface TaskPriorityUserMessage {
  userMessage: string;
}

export interface TaskPriorityFieldProps extends Omit<
  FieldComponentProps<TaskPrioritySystemMessageData | TaskPriorityUserMessage>,
  "onChange"
> {
  value?: TaskPrioritySystemMessageData | TaskPriorityUserMessage;
  onChange?: (value: TaskPriorityUserMessage) => void;
}

// Type guard to check if value is TaskPrioritySystemMessageData
const isTaskPrioritySystemMessageData = (
  value: TaskPrioritySystemMessageData | TaskPriorityUserMessage | undefined,
): value is TaskPrioritySystemMessageData => {
  if (value && isObject(value)) {
    return "priorityQueue" in value && "response" in value && "type" in value;
  }
  return false;
};

export const TaskPriorityField: React.FC<TaskPriorityFieldProps> = ({
  config,
  value,
  onChange,
  error,
  disabled = false,
  isSubmitted = false,
}) => {
  // Extract task priority data from value if it's the system message type
  const taskPriorityData = isTaskPrioritySystemMessageData(value)
    ? value
    : undefined;

  // Local state to track the field value
  const [fieldValue, setFieldValue] = useState<TaskPriorityUserMessage>({
    userMessage: "",
  });

  // Initialize form value from incoming system message data
  useEffect(() => {
    if (taskPriorityData && !fieldValue.userMessage) {
      const initialValue: TaskPriorityUserMessage = {
        userMessage: "",
      };
      setFieldValue(initialValue);
      onChange?.(initialValue);
    }
  }, [taskPriorityData, fieldValue.userMessage, onChange]);

  // Error handling for invalid data
  if (!taskPriorityData) {
    return (
      <Box sx={{ p: 2, color: "error.main" }}>
        <Typography>Error: Invalid task priority data</Typography>
      </Box>
    );
  }

  // Event handlers
  const handleFeedbackChange = (text: string) => {
    const newValue: TaskPriorityUserMessage = {
      userMessage: text,
    };
    setFieldValue(newValue);
    onChange?.(newValue);
  };

  // Submitted view
  if (isSubmitted) {
    return (
      <Box sx={{ mb: 2 }}>
        {/* System Response */}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {taskPriorityData.response}
        </Typography>

        {/* Priority Queue Summary */}
        <Box
          sx={{
            p: 2,
            backgroundColor: "grey.50",
            borderRadius: 1,
          }}
        >
          <Typography variant="body2" sx={{ mb: 1 }}>
            Priority Queue: {taskPriorityData.priorityQueue.length} tasks
          </Typography>
          {taskPriorityData.priorityQueue.map(
            (
              task: TaskPrioritySystemMessageDataAllOfPriorityQueue,
              index: number,
            ) => (
              <Box key={task.taskId} sx={{ mb: 1, pl: 2 }}>
                <Typography variant="body2" fontWeight="medium">
                  {index + 1}. {task.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {task.rationale}
                </Typography>
              </Box>
            ),
          )}
        </Box>

        {/* User feedback if provided */}
        {fieldValue.userMessage && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1, mt: 2 }}>
              User Feedback:
            </Typography>
            <Typography variant="body2" sx={{ pl: 2, fontStyle: "italic" }}>
              &quot;{fieldValue.userMessage}&quot;
            </Typography>
          </>
        )}
      </Box>
    );
  }

  // Active editing view
  return (
    <Box sx={{ mb: 2 }} data-testid={`task-priority-field-${config.field}`}>
      {/* System Response */}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {taskPriorityData.response}
      </Typography>

      {/* Reasoning */}
      {taskPriorityData.reasoning && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 2, fontStyle: "italic" }}
        >
          {taskPriorityData.reasoning}
        </Typography>
      )}

      {/* Priority Queue List */}
      <Box
        sx={{
          backgroundColor: "grey.100",
          border: 1,
          borderColor: "grey.300",
          borderRadius: "4px",
          p: 1,
          mb: 2,
        }}
      >
        <List sx={{ py: 0 }}>
          {taskPriorityData.priorityQueue.map(
            (
              task: TaskPrioritySystemMessageDataAllOfPriorityQueue,
              index: number,
            ) => (
              <ListItem
                key={task.taskId}
                sx={{
                  py: 1,
                  px: 1.5,
                  display: "flex",
                  alignItems: "flex-start",
                  backgroundColor: "background.paper",
                  borderTop: index > 0 ? 1 : 0,
                  borderColor: "grey.200",
                }}
                data-testid={`task-priority-${task.taskId}`}
              >
                <Box
                  sx={{
                    mr: 2,
                    minWidth: 24,
                    height: 24,
                    borderRadius: "50%",
                    backgroundColor: "primary.main",
                    color: "primary.contrastText",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.75rem",
                    fontWeight: "bold",
                  }}
                >
                  {index + 1}
                </Box>
                <ListItemText
                  primary={task.title}
                  secondary={task.rationale}
                  sx={{ flex: 1, my: 0 }}
                  slotProps={{
                    primary: {
                      variant: "body2",
                      fontWeight: "medium",
                    },
                    secondary: {
                      variant: "caption",
                      sx: { mt: 0.25 },
                    },
                  }}
                />
              </ListItem>
            ),
          )}
        </List>
      </Box>

      {/* Feedback Textarea */}
      <TextField
        multiline
        rows={4}
        fullWidth
        value={fieldValue.userMessage}
        onChange={(e) => handleFeedbackChange(e.target.value)}
        placeholder="Add feedback or continue the conversation..."
        disabled={disabled}
        variant="outlined"
        label="Your Feedback (Optional)"
        data-testid="feedback-textarea"
      />

      {/* Error display */}
      {error && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
};
