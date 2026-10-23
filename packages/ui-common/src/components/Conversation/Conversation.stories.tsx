import { Box, Grid, Typography } from "@mui/material";
import { Conversation } from "./Conversation";
import { ConversationViewer } from "./ConversationViewer";
import { ConversationNavigator } from "./ConversationNavigator";
import type {
  ConversationResponseDto,
  MessageResponseDto,
  ProjectResponseDto,
} from "../../api";

// Mock data for comprehensive demo
const mockProject: ProjectResponseDto = {
  id: "proj-1",
  organizationId: "org-1",
  name: "AI Analytics Platform",
  description: "Building an AI-powered analytics platform",
  status: "ACTIVE",
  tags: [],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

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
          "Let's start by understanding your project better. What problem are you solving?",
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
      responses: [
        {
          id: "resp-1",
          workflowId: "workflow-1",
          projectId: "proj-1",
          type: "USER",
          status: "COMPLETED",
          data: {
            project_concept:
              "A comprehensive analytics platform that uses AI to provide insights for business teams",
          },
          conversationId: "conv-1",
          parentMessageId: "msg-1",
          createdAt: "2024-01-01T01:00:00Z",
          awaitingResponse: false,
        },
      ],
    },
    {
      id: "msg-3",
      workflowId: "workflow-1",
      projectId: "proj-1",
      type: "SYSTEM",
      status: "COMPLETED",
      data: {
        type: "QUESTIONS",
        title: "Technical Architecture",
        response:
          "Great concept! Now let's discuss the technical architecture. What technologies are you planning to use?",
        uiElements: [
          {
            id: "tech_stack",
            type: "text_input",
            label: "Primary technology stack",
            required: true,
          },
          {
            id: "deployment",
            type: "select",
            label: "Deployment preference",
            options: [
              { value: "cloud", label: "Cloud (AWS/Azure/GCP)" },
              { value: "on-premise", label: "On-premise" },
              { value: "hybrid", label: "Hybrid approach" },
            ],
          },
        ],
      },
      conversationId: "conv-1",
      parentMessageId: null,
      createdAt: "2024-01-01T02:00:00Z",
      awaitingResponse: false,
      responses: [
        {
          id: "resp-2",
          workflowId: "workflow-1",
          projectId: "proj-1",
          type: "USER",
          status: "COMPLETED",
          data: {
            tech_stack: "React, Node.js, PostgreSQL, Python ML services",
            deployment: "cloud",
          },
          conversationId: "conv-1",
          parentMessageId: "msg-3",
          createdAt: "2024-01-01T03:00:00Z",
          awaitingResponse: false,
        },
      ],
    },
    {
      id: "msg-5",
      workflowId: "workflow-1",
      projectId: "proj-1",
      type: "SYSTEM",
      status: "OPEN",
      data: {
        type: "QUESTIONS",
        title: "Team & Timeline Planning",
        response:
          "Excellent choices! Let's plan your team structure and project timeline to ensure successful delivery.",
        uiElements: [
          {
            id: "team_size",
            type: "select",
            label: "Expected team size",
            required: true,
            options: [
              { value: "1-3", label: "Small team (1-3 people)" },
              { value: "4-8", label: "Medium team (4-8 people)" },
              { value: "9+", label: "Large team (9+ people)" },
            ],
          },
          {
            id: "timeline",
            type: "select",
            label: "Target timeline",
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
  title: "Components/ConversationManager",
  component: Conversation,
};

export const FullConversationManager = () => (
  <Box sx={{ p: 3 }}>
    <Typography variant="h4" gutterBottom>
      Complete Conversation Manager
    </Typography>
    <Typography variant="body1" sx={{ mb: 3, color: "text.secondary" }}>
      Full-featured conversation component with navigation, WebSocket updates,
      and form handling
    </Typography>

    <Conversation
      conversation={mockConversation}
      project={mockProject}
      navigationOrientation="horizontal"
      title="Project Onboarding"
      subtitle="Let's set up your project for success"
      onConversationUpdated={async () => {
        console.log("Conversation updated - would refresh data here");
        // Simulate API call delay
        await new Promise((resolve) => setTimeout(resolve, 500));
      }}
      showNavigation={true}
    />
  </Box>
);

export const HorizontalWithSidebar = () => (
  <Box sx={{ p: 3 }}>
    <Typography variant="h4" gutterBottom>
      Horizontal + Vertical Layouts
    </Typography>

    <Grid container spacing={3}>
      {/* Main conversation with horizontal navigation */}
      <Grid size={{ xs: 8 }}>
        <ConversationViewer
          conversation={mockConversation}
          project={mockProject}
          navigationOrientation="horizontal"
          title="Main Conversation"
          onConversationUpdated={async () => {
            console.log("Main conversation updated");
          }}
          showNavigation={true}
        />
      </Grid>

      {/* Sidebar with vertical navigation */}
      <Grid size={{ xs: 4 }}>
        <Box sx={{ position: "sticky", top: 20 }}>
          <ConversationNavigator
            conversation={mockConversation}
            orientation="vertical"
            activeStep={2}
            onStepClick={(stepIndex, message) => {
              console.log("Navigate to:", stepIndex, message.data.title);
            }}
          />
        </Box>
      </Grid>
    </Grid>
  </Box>
);

export const ConversationViewerOnly = () => (
  <Box sx={{ p: 3 }}>
    <Typography variant="h4" gutterBottom>
      Conversation Viewer (No Navigation)
    </Typography>
    <Typography variant="body1" sx={{ mb: 3, color: "text.secondary" }}>
      Just the conversation content without navigation elements
    </Typography>

    <ConversationViewer
      conversation={mockConversation}
      project={mockProject}
      onConversationUpdated={async () => {
        console.log("Conversation updated");
      }}
      onCreateNewConversation={async () => {
        console.log("Create new conversation");
      }}
      showNavigation={false}
    />
  </Box>
);

export const InteractiveDemo = () => (
  <Box sx={{ p: 3 }}>
    <Typography variant="h4" gutterBottom>
      Interactive Demo
    </Typography>
    <Typography variant="body1" sx={{ mb: 3, color: "text.secondary" }}>
      Try submitting the form to see how conversations work
    </Typography>

    <Conversation
      conversation={mockConversation}
      project={mockProject}
      navigationOrientation="horizontal"
      title="Interactive Conversation"
      subtitle="Submit the form to see real-time updates"
      onConversationUpdated={async () => {
        console.log("🔄 Conversation would be updated from API");
        // In real app, this would refetch conversation data
      }}
      enableWebSocket={false}
      showNavigation={true}
    />
  </Box>
);
