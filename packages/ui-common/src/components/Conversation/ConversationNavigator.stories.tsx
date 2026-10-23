import { Box, Grid, Typography } from "@mui/material";
import { ConversationNavigator } from "./ConversationNavigator";
import type { ConversationResponseDto, MessageResponseDto } from "../../api";

// Mock conversation data for demo
const mockConversation: ConversationResponseDto = {
  id: "conv-1",
  projectId: "proj-1",
  workflowId: "workflow-1",
  interactionTypeId: "onboarding",
  initiatedBy: "USER",
  status: "STARTED",
  category: "onboarding",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  messages: [
    {
      id: "msg-1",
      workflowId: "workflow-1",
      projectId: "proj-1",
      type: "SYSTEM",
      status: "COMPLETED",
      data: {
        type: "QUESTIONS",
        title: "Project Understanding",
        response:
          "Let's start by understanding your project better. What are you building?",
        uiElements: [
          {
            id: "project_concept",
            type: "textarea",
            label: "Describe your project concept",
            required: true,
          },
        ],
      },
      conversationId: "conv-1",
      parentMessageId: null,
      createdAt: "2024-01-01T00:00:00Z",
      awaitingResponse: false,
    },
    {
      id: "msg-2",
      workflowId: "workflow-1",
      projectId: "proj-1",
      type: "USER",
      status: "COMPLETED",
      data: {
        project_concept: "A project management tool with AI-powered insights",
      },
      conversationId: "conv-1",
      parentMessageId: "msg-1",
      createdAt: "2024-01-01T01:00:00Z",
      awaitingResponse: false,
    },
    {
      id: "msg-3",
      workflowId: "workflow-1",
      projectId: "proj-1",
      type: "SYSTEM",
      status: "COMPLETED",
      data: {
        type: "QUESTIONS",
        title: "Technical Analysis",
        response:
          "Great! Now let's dive into the technical aspects of your project.",
        uiElements: [
          {
            id: "tech_stack",
            type: "text_input",
            label: "What technology stack are you using?",
            required: true,
          },
        ],
      },
      conversationId: "conv-1",
      parentMessageId: null,
      createdAt: "2024-01-01T02:00:00Z",
      awaitingResponse: false,
    },
    {
      id: "msg-4",
      workflowId: "workflow-1",
      projectId: "proj-1",
      type: "USER",
      status: "COMPLETED",
      data: {
        tech_stack: "React, Node.js, PostgreSQL",
      },
      conversationId: "conv-1",
      parentMessageId: "msg-3",
      createdAt: "2024-01-01T03:00:00Z",
      awaitingResponse: false,
    },
    {
      id: "msg-5",
      workflowId: "workflow-1",
      projectId: "proj-1",
      type: "SYSTEM",
      status: "OPEN",
      data: {
        type: "QUESTIONS",
        title: "Initiative Planning",
        response:
          "Perfect! Let's now plan your project initiatives and milestones.",
        uiElements: [
          {
            id: "timeline",
            type: "select",
            label: "What's your target timeline?",
            required: true,
            options: [
              { value: "3-months", label: "3 months" },
              { value: "6-months", label: "6 months" },
              { value: "12-months", label: "12+ months" },
            ],
          },
        ],
      },
      conversationId: "conv-1",
      parentMessageId: null,
      createdAt: "2024-01-01T04:00:00Z",
      awaitingResponse: true,
    },
  ] as MessageResponseDto[],
};

export default {
  title: "Components/ConversationNavigator",
  component: ConversationNavigator,
};

export const HorizontalOrientation = () => (
  <Box sx={{ p: 3 }}>
    <Typography variant="h4" gutterBottom>
      Horizontal Conversation Navigator
    </Typography>
    <Typography variant="body1" sx={{ mb: 3, color: "text.secondary" }}>
      Traditional stepper layout showing progress through conversation steps
    </Typography>

    <ConversationNavigator
      conversation={mockConversation}
      orientation="horizontal"
      activeStep={2} // Currently on "Initiative Planning"
      title="Project Onboarding"
      subtitle="Let's get your project set up properly"
      showProgress={true}
    />
  </Box>
);

export const VerticalOrientation = () => (
  <Box sx={{ p: 3 }}>
    <Typography variant="h4" gutterBottom>
      Vertical Conversation Navigator
    </Typography>
    <Typography variant="body1" sx={{ mb: 3, color: "text.secondary" }}>
      Sidebar layout allowing navigation between conversation steps
    </Typography>

    <Grid container spacing={3}>
      <Grid size={{ xs: 4 }}>
        <ConversationNavigator
          conversation={mockConversation}
          orientation="vertical"
          activeStep={2}
          onStepClick={(stepIndex, message) => {
            console.log("Clicked step:", stepIndex, message.data.title);
          }}
        />
      </Grid>
      <Grid size={{ xs: 8 }}>
        <Box
          sx={{
            p: 3,
            backgroundColor: "grey.50",
            borderRadius: 2,
            minHeight: 400,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Typography variant="h6" color="text.secondary">
            Main conversation content would appear here
          </Typography>
        </Box>
      </Grid>
    </Grid>
  </Box>
);

export const BothOrientations = () => (
  <Box sx={{ p: 3 }}>
    <Typography variant="h4" gutterBottom>
      Comparison: Both Orientations
    </Typography>

    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Horizontal (Progress Indicator)
      </Typography>
      <ConversationNavigator
        conversation={mockConversation}
        orientation="horizontal"
        activeStep={1}
        showProgress={true}
      />
    </Box>

    <Box>
      <Typography variant="h6" gutterBottom>
        Vertical (Sidebar Navigation)
      </Typography>
      <ConversationNavigator
        conversation={mockConversation}
        orientation="vertical"
        activeStep={1}
        onStepClick={(stepIndex, message) => {
          console.log("Navigate to:", message.data.title);
        }}
      />
    </Box>
  </Box>
);
