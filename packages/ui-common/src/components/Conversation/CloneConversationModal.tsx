import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import React, { useState, useMemo } from "react";
import {
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  Box,
  RadioGroup,
  FormControlLabel,
  Radio,
  CircularProgress,
  Alert,
} from "@mui/material";
import type {
  ConversationResponseDto,
  MessageResponseDto,
  CloneConversationDto,
} from "../../api";
import { useConversationByWorkflow } from "../../data/hooks/useConversationByWorkflow";
import { apiClient } from "../../clients/client";

interface CloneConversationModalProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  projectId: string;
  onCloneSuccess?: (clonedConversation: ConversationResponseDto) => void;
  onError?: (error: unknown) => void;
}

interface SystemMessageNode {
  messageId: string;
  nodeId: string;
  title: string;
  type: string;
  description?: string;
}

export const CloneConversationModal: React.FC<CloneConversationModalProps> = ({
  open,
  onClose,
  organizationId,
  projectId,
  onCloneSuccess,
  onError,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the onboarding conversation to get the available nodes
  const {
    data: onboardingConversation,
    messages,
    isLoading: isLoadingOnboarding,
    error: onboardingError,
  } = useConversationByWorkflow(organizationId, projectId, "onboarding", {
    enabled: open, // Only load when modal is open
  });

  // Extract system messages with nodeId from the onboarding conversation
  const systemMessageNodes = useMemo((): SystemMessageNode[] => {
    if (!messages) {
      return [];
    }

    const nodes: SystemMessageNode[] = [];

    // Recursive function to extract nodes from message tree
    const extractNodesFromMessage = (message: MessageResponseDto): void => {
      // Check if this is a system message with nodeId in its data
      if (message.type === "SYSTEM" && message.data) {
        const messageData = message.data as {
          nodeId?: string;
          title?: string;
          type?: string;
          response?: string;
        };

        if (messageData.nodeId) {
          nodes.push({
            messageId: message.id,
            nodeId: messageData.nodeId,
            title:
              messageData.title ||
              messageData.response ||
              `Node ${messageData.nodeId}`,
            type: messageData.type || "Unknown",
            description: messageData.response,
          });
        }
      }

      // Recursively process responses
      if (message.responses && Array.isArray(message.responses)) {
        message.responses.forEach(extractNodesFromMessage);
      }
    };

    // Process all top-level messages
    messages.forEach(extractNodesFromMessage);

    // Remove duplicates based on nodeId and sort by order of appearance
    const uniqueNodes = nodes.filter(
      (node, index, self) =>
        index === self.findIndex((n) => n.nodeId === node.nodeId),
    );

    return uniqueNodes;
  }, [messages]);

  const handleClone = async (): Promise<void> => {
    if (!selectedNodeId) {
      setError("Please select a node to clone to.");
      return;
    }

    if (!onboardingConversation?.id) {
      setError("No onboarding conversation found to clone from.");
      return;
    }

    setIsCloning(true);
    setError(null);

    try {
      const cloneData: CloneConversationDto = {
        targetNodeId: selectedNodeId,
        title: `Cloned Conversation`, // Default title, API will add "(Clone)" suffix
      };

      // Use the onboarding conversation ID as the conversation to clone FROM
      const response = await apiClient.cloneConversation({
        organizationId: organizationId,
        projectId: projectId,
        conversationId: onboardingConversation.id,
        cloneConversationDto: cloneData,
      });

      const clonedConversation = response.data.data?.conversation;

      if (clonedConversation) {
        onCloneSuccess?.(clonedConversation);
        handleClose();
      } else {
        throw new Error("No cloned conversation data received");
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to clone conversation";
      setError(errorMessage);
      onError?.(err);
    } finally {
      setIsCloning(false);
    }
  };

  const handleClose = (): void => {
    setSelectedNodeId("");
    setError(null);
    onClose();
  };

  if (!open) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      aria-labelledby="clone-conversation-dialog-title"
      maxWidth="md"
      fullWidth
    >
      <DialogTitle id="clone-conversation-dialog-title">
        Clone Conversation
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Select a workflow node from the onboarding conversation to clone up
          to. The cloned conversation will include all messages and initiatives
          up to the selected node.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {isLoadingOnboarding && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress />
            <Typography variant="body2" sx={{ ml: 2 }}>
              Loading onboarding conversation...
            </Typography>
          </Box>
        )}

        {onboardingError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Failed to load onboarding conversation: {onboardingError.message}
          </Alert>
        )}

        {systemMessageNodes.length === 0 &&
          !isLoadingOnboarding &&
          !onboardingError && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              No workflow nodes found in the onboarding conversation.
            </Alert>
          )}

        {systemMessageNodes.length > 0 && (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Available Workflow Nodes:
            </Typography>
            <RadioGroup
              value={selectedNodeId}
              onChange={(e) => setSelectedNodeId(e.target.value)}
            >
              <List dense>
                {systemMessageNodes.map((node) => (
                  <ListItem key={node.nodeId} disablePadding>
                    <ListItemButton
                      onClick={() => setSelectedNodeId(node.nodeId)}
                      selected={selectedNodeId === node.nodeId}
                    >
                      <FormControlLabel
                        value={node.nodeId}
                        control={<Radio />}
                        label=""
                        sx={{ mr: 1 }}
                      />
                      <ListItemText
                        primary={node.title}
                        secondary={
                          <Box>
                            <Typography variant="caption" display="block">
                              Node ID: {node.nodeId}
                            </Typography>
                            <Typography variant="caption" display="block">
                              Type: {node.type}
                            </Typography>
                            {node.description && (
                              <Typography
                                variant="caption"
                                display="block"
                                sx={{
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  display: "-webkit-box",
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical",
                                  mt: 0.5,
                                }}
                              >
                                {node.description}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </RadioGroup>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isCloning}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleClone}
          disabled={
            !selectedNodeId || isCloning || systemMessageNodes.length === 0
          }
        >
          {isCloning ? (
            <>
              <CircularProgress size={16} sx={{ mr: 1 }} />
              Cloning...
            </>
          ) : (
            "Clone Conversation"
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
