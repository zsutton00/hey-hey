import { useModalState } from "../../Modals/useModalState";
import { FunctionalDialog as Dialog } from "../../Modals/FunctionalDialog";
import React, { useState, useEffect } from "react";
import {
  alpha,
  Box,
  Button,
  Chip,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import type { FieldComponentProps } from "./types";
import {
  TaskStubUserMessageNextActionEnum,
  type TaskStubSystemMessageData,
  type TaskStub,
  type TaskStubStatusEnum,
  type TaskStubUserMessage,
  type TaskStubReviewActionEnum,
  type ManualTaskStub,
} from "../../../api";
import isObject from "lodash/isObject.js";

export interface TaskStubPayload {
  action: "finalize" | "refine";
  feedback: string;
  stubReviews: Record<string, TaskStubReviewActionEnum>;
  manualStubs: Array<ManualTaskStub>;
}

export interface TaskStubFieldProps extends Omit<
  FieldComponentProps<TaskStubSystemMessageData | TaskStubUserMessage>,
  "onChange"
> {
  value?: TaskStubSystemMessageData | TaskStubUserMessage;
  onChange?: (value: TaskStubUserMessage) => void;
}

// Type guard to check if value is TaskStubSystemMessageData
const isTaskStubSystemMessageData = (
  value: TaskStubSystemMessageData | TaskStubUserMessage | undefined,
): value is TaskStubSystemMessageData => {
  if (value && isObject(value)) {
    return "stubs" in value && "response" in value && "type" in value;
  }

  return false;
};

// Helper function to check if there are approved stubs
export const hasApprovedStubs = (
  value: TaskStubUserMessage | undefined,
): boolean => {
  if (!value) return false;
  return (
    value.stubReviews.some((r) => r.action === "accept") ||
    value.manuallyAdded.length > 0
  );
};

// Helper function to prepare payload for backend
export const prepareTaskStubPayload = (
  value: TaskStubUserMessage,
  action: "finalize" | "refine",
): TaskStubPayload => {
  return {
    action,
    feedback: value.userMessage ?? "",
    stubReviews: Object.fromEntries(
      value.stubReviews.map((r) => [r.stubId, r.action]),
    ),
    manualStubs: value.manuallyAdded,
  };
};

const validateManualTask = (
  title: string,
  description: string,
): string | null => {
  if (!title.trim()) return "Title is required";
  if (title.length > 200) return "Title too long (max 200 characters)";
  if (!description.trim()) return "Description is required";
  if (description.length > 500)
    return "Description too long (max 500 characters)";
  return null;
};

export const TaskStubField: React.FC<TaskStubFieldProps> = ({
  config,
  value,
  onChange,
  error,
  disabled = false,
  isSubmitted = false,
}) => {
  const theme = useTheme();
  // Extract task stub data from value if it's the system message type
  const taskStubData = isTaskStubSystemMessageData(value) ? value : undefined;

  // Dialog state
  const [addDialogOpen, setAddDialogOpen, addDialogOpenOwnerKey] =
    useModalState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Submitted view expansion
  const [isExpanded, setIsExpanded] = useState(false);

  // Local state to track the field value
  const [fieldValue, setFieldValue] = useState<TaskStubUserMessage | undefined>(
    !isTaskStubSystemMessageData(value) ? value : undefined,
  );

  // Initialize form value from incoming system message data
  useEffect(() => {
    if (taskStubData && !fieldValue) {
      const initialValue: TaskStubUserMessage = {
        ...taskStubData,
        userMessage: "",
        stubReviews: taskStubData.stubs.map((stub) => ({
          stubId: stub.id,
          action:
            stub.status === ("approved" as TaskStubStatusEnum)
              ? ("accept" as const)
              : stub.status === ("rejected" as TaskStubStatusEnum)
                ? ("reject" as const)
                : ("pending" as const),
        })),
        manuallyAdded: [],
        // Default to generating stubs - will be updated when user clicks Generate Tasks
        nextAction: TaskStubUserMessageNextActionEnum.GenerateStubs,
      };
      setFieldValue(initialValue);
      onChange?.(initialValue);
    }
  }, [taskStubData, fieldValue, onChange]);

  // Error handling for invalid data
  if (!taskStubData) {
    return (
      <Box sx={{ p: 2, color: "error.main" }}>
        <Typography>Error: Invalid task stub data</Typography>
      </Box>
    );
  }

  // Event handlers
  const handleAccept = (stubId: string) => {
    if (!fieldValue) return;

    const updatedReviews = fieldValue.stubReviews.map((review) =>
      review.stubId === stubId
        ? { ...review, action: "accept" as const }
        : review,
    );

    const newValue = {
      ...fieldValue,
      stubReviews: updatedReviews,
    };
    setFieldValue(newValue);
    onChange?.(newValue);
  };

  const handleReject = (stubId: string) => {
    if (!fieldValue) return;

    const updatedReviews = fieldValue.stubReviews.map((review) =>
      review.stubId === stubId
        ? { ...review, action: "reject" as const }
        : review,
    );

    const newValue = {
      ...fieldValue,
      stubReviews: updatedReviews,
    };
    setFieldValue(newValue);
    onChange?.(newValue);
  };

  const handleFeedbackChange = (text: string) => {
    if (!fieldValue) return;

    const newValue = {
      ...fieldValue,
      userMessage: text,
    };
    setFieldValue(newValue);
    onChange?.(newValue);
  };

  const handleCloseDialog = () => {
    setAddDialogOpen(false);
    setNewTaskTitle("");
    setNewTaskDescription("");
    setDialogError(null);
  };

  const handleAddTask = () => {
    const validationError = validateManualTask(
      newTaskTitle,
      newTaskDescription,
    );
    if (validationError) {
      setDialogError(validationError);
      return;
    }

    if (!fieldValue) return;

    const newValue = {
      ...fieldValue,
      manuallyAdded: [
        ...fieldValue.manuallyAdded,
        {
          title: newTaskTitle.trim(),
          shortDescription: newTaskDescription.trim(),
        },
      ],
    };
    setFieldValue(newValue);
    onChange?.(newValue);

    handleCloseDialog();
  };

  // Get review status for a stub
  const getStubStatus = (stubId: string): "accept" | "reject" | "pending" => {
    const review = fieldValue?.stubReviews.find((r) => r.stubId === stubId);
    return review?.action ?? "pending";
  };

  const getStubBackgroundColor = (
    status: "accept" | "reject" | "pending" | "user_added",
  ): string => {
    switch (status) {
      case "accept":
        return theme.palette.mode === "dark"
          ? alpha(theme.palette.success.main, 0.24)
          : "success.50";
      case "user_added":
        return theme.palette.mode === "dark"
          ? alpha(theme.palette.primary.main, 0.24)
          : "primary.50";
      default:
        return "background.paper";
    }
  };

  // Submitted view
  if (isSubmitted) {
    const acceptedCount =
      fieldValue?.stubReviews.filter((r) => r.action === "accept").length ?? 0;
    const rejectedCount =
      fieldValue?.stubReviews.filter((r) => r.action === "reject").length ?? 0;
    const addedCount = fieldValue?.manuallyAdded.length ?? 0;

    return (
      <Box sx={{ mb: 2 }}>
        {/* System Response */}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {taskStubData.response}
        </Typography>

        {/* Compact Summary */}
        <Box
          sx={{
            p: 2,
            backgroundColor:
              theme.palette.mode === "dark" ? "grey.900" : "grey.50",
            borderRadius: 1,
            cursor: "pointer",
          }}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Typography variant="body2">
              Review Complete: {acceptedCount} accepted, {rejectedCount}{" "}
              rejected
              {addedCount > 0 && `, ${addedCount} added manually`}
            </Typography>
            <IconButton size="small">
              {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>
        </Box>

        {/* Expanded Details */}
        {isExpanded && (
          <Box sx={{ mt: 2 }}>
            {/* Show accepted stubs */}
            {acceptedCount > 0 && (
              <>
                <Typography
                  variant="subtitle2"
                  color="success.main"
                  sx={{ mb: 1 }}
                >
                  Accepted Tasks:
                </Typography>
                {taskStubData.stubs
                  .filter(
                    (stub) =>
                      fieldValue?.stubReviews.find((r) => r.stubId === stub.id)
                        ?.action === "accept",
                  )
                  .map((stub) => (
                    <Box key={stub.id} sx={{ mb: 1, pl: 2 }}>
                      <Typography variant="body2" fontWeight="medium">
                        ✓ {stub.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {stub.shortDescription}
                      </Typography>
                    </Box>
                  ))}
              </>
            )}

            {/* Show manually added stubs */}
            {addedCount > 0 && (
              <>
                <Typography
                  variant="subtitle2"
                  color="primary.main"
                  sx={{ mb: 1, mt: 2 }}
                >
                  Manually Added:
                </Typography>
                {fieldValue?.manuallyAdded.map((stub, idx) => (
                  <Box key={idx} sx={{ mb: 1, pl: 2 }}>
                    <Typography variant="body2" fontWeight="medium">
                      + {stub.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {stub.shortDescription}
                    </Typography>
                  </Box>
                ))}
              </>
            )}

            {/* Show rejected stubs */}
            {rejectedCount > 0 && (
              <>
                <Typography
                  variant="subtitle2"
                  color="text.disabled"
                  sx={{ mb: 1, mt: 2 }}
                >
                  Rejected Tasks:
                </Typography>
                {taskStubData.stubs
                  .filter(
                    (stub) =>
                      fieldValue?.stubReviews.find((r) => r.stubId === stub.id)
                        ?.action === "reject",
                  )
                  .map((stub) => (
                    <Box key={stub.id} sx={{ mb: 1, pl: 2 }}>
                      <Typography variant="body2" color="text.disabled">
                        ✗ {stub.title}
                      </Typography>
                    </Box>
                  ))}
              </>
            )}

            {/* User feedback if provided */}
            {fieldValue?.userMessage && (
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
        )}
      </Box>
    );
  }

  // Active editing view
  return (
    <Box sx={{ mb: 2 }} data-testid={`task-stub-field-${config.field}`}>
      {/* Task Stub List */}
      <Box
        sx={{
          backgroundColor:
            theme.palette.mode === "dark" ? "grey.900" : "grey.100",
          border: 1,
          borderColor: "divider",
          borderRadius: "4px",
          p: 1,
          mb: 2,
        }}
      >
        <List sx={{ py: 0 }}>
          {taskStubData.stubs.map((stub: TaskStub, index: number) => {
            const status = getStubStatus(stub.id);
            return (
              <ListItem
                key={stub.id}
                sx={{
                  py: 1,
                  px: 1.5,
                  display: "flex",
                  alignItems: "flex-start",
                  backgroundColor: getStubBackgroundColor(status),
                  opacity: status === "reject" ? 0.6 : 1,
                  borderTop: index > 0 ? 1 : 0,
                  borderColor: "divider",
                }}
                data-testid={`task-stub-${stub.id}`}
              >
                <ListItemText
                  primary={stub.title}
                  secondary={stub.shortDescription}
                  sx={{ flex: 1, mr: 2, my: 0 }}
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
                <Box
                  sx={{
                    display: "flex",
                    gap: 0.5,
                    flexShrink: 0,
                    width: 72,
                    justifyContent: "flex-end",
                  }}
                >
                  <IconButton
                    size="small"
                    onClick={() => handleAccept(stub.id)}
                    disabled={disabled}
                    data-testid={`accept-${stub.id}`}
                    sx={{
                      width: 28,
                      height: 28,
                      bgcolor:
                        status === "accept"
                          ? "success.main"
                          : theme.palette.mode === "dark"
                            ? alpha(theme.palette.success.main, 0.2)
                            : "success.50",
                      color: status === "accept" ? "white" : "success.main",
                      border: 1,
                      borderColor: "success.main",
                      "&:hover": {
                        bgcolor:
                          status === "accept" ? "success.dark" : "success.100",
                      },
                    }}
                  >
                    <CheckIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => handleReject(stub.id)}
                    disabled={disabled}
                    data-testid={`reject-${stub.id}`}
                    sx={{
                      width: 28,
                      height: 28,
                      bgcolor:
                        status === "reject"
                          ? "error.main"
                          : theme.palette.mode === "dark"
                            ? alpha(theme.palette.error.main, 0.2)
                            : "error.50",
                      color: status === "reject" ? "white" : "error.main",
                      border: 1,
                      borderColor: "error.main",
                      "&:hover": {
                        bgcolor:
                          status === "reject" ? "error.dark" : "error.100",
                      },
                    }}
                  >
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              </ListItem>
            );
          })}
        </List>

        {/* Manually Added Tasks */}
        {fieldValue?.manuallyAdded && fieldValue.manuallyAdded.length > 0 && (
          <>
            {fieldValue.manuallyAdded.map((stub, idx) => (
              <ListItem
                key={`manual-${idx}`}
                sx={{
                  py: 1,
                  px: 1.5,
                  display: "flex",
                  alignItems: "flex-start",
                  backgroundColor: getStubBackgroundColor("user_added"),
                  borderTop: 1,
                  borderColor: "divider",
                }}
                data-testid={`manual-task-${idx}`}
              >
                <ListItemText
                  primary={stub.title}
                  secondary={stub.shortDescription}
                  sx={{ flex: 1, mr: 2, my: 0 }}
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
                <Box
                  sx={{
                    flexShrink: 0,
                    width: 72,
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  <Chip label="Added" size="small" color="primary" />
                </Box>
              </ListItem>
            ))}
          </>
        )}

        {/* Add Task Button */}
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setAddDialogOpen(true)}
          disabled={disabled}
          sx={{ mt: 2, mb: 1 }}
          color="actionable"
          data-testid="add-task-button"
        >
          Add Task Manually
        </Button>
      </Box>

      {/* Feedback Textarea */}
      <TextField
        multiline
        rows={4}
        fullWidth
        value={fieldValue?.userMessage ?? ""}
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

      {/* Add Task Dialog */}
      <Dialog
        ownerKey={addDialogOpenOwnerKey}
        open={addDialogOpen}
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Task Manually</DialogTitle>
        <DialogContent>
          <TextField
            label="Task Title"
            fullWidth
            value={newTaskTitle}
            onChange={(e) => {
              setNewTaskTitle(e.target.value);
              setDialogError(null);
            }}
            sx={{ mb: 2, mt: 1 }}
            required
            error={!!dialogError && !newTaskTitle.trim()}
            data-testid="new-task-title"
          />
          <TextField
            label="Short Description"
            fullWidth
            multiline
            rows={3}
            value={newTaskDescription}
            onChange={(e) => {
              setNewTaskDescription(e.target.value);
              setDialogError(null);
            }}
            required
            error={!!dialogError && !newTaskDescription.trim()}
            data-testid="new-task-description"
          />
          {dialogError && (
            <Typography variant="body2" color="error" sx={{ mt: 1 }}>
              {dialogError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button
            onClick={handleAddTask}
            variant="contained"
            disabled={!newTaskTitle.trim() || !newTaskDescription.trim()}
            data-testid="confirm-add-task"
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
