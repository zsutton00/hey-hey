import type { Meta, StoryObj } from "@storybook/react";
import { Box, List } from "@mui/material";
import { MemoryRouter } from "react-router-dom";
import type { NotificationRecord } from "../../data/collections/notifications";
import { NotificationItem } from "./NotificationItem";

const baseGenericFixture: NotificationRecord = {
  id: "notification-generic-1" as NotificationRecord["id"],
  notificationId: "notification-generic-1",
  eventType: "report.created",
  reportId: "report-1",
  createdAt: "2026-05-16T15:30:00.000Z",
  status: "unread",
  readAt: null,
  acknowledgedAt: null,
  dismissedAt: null,
  affectedEntityCount: 1,
  isRead: false,
  isAcknowledged: false,
  preview: {
    title: "Report created",
    summary:
      "Review the latest release readiness report for the pricing rollout.",
  },
  source: {
    id: "notification-generic-1",
    eventType: "report.created",
    entityId: "report-1",
    entityType: "REPORT",
    entityTitle: "Release Readiness Report",
    affectedEntities: [],
    payload: {
      nextSteps: [],
      verificationTasks: [],
      recommendedUpdates: [],
    },
    createdAt: "2026-05-16T15:30:00.000Z",
    status: "unread",
  },
};

const sessionReportReadyFixture: NotificationRecord = {
  ...baseGenericFixture,
  id: "notification-session-1" as NotificationRecord["id"],
  notificationId: "notification-session-1",
  eventType: "session_report_ready",
  reportId: "report-session-1",
  preview: {
    title: "Report ready",
    summary: "The agent has summarized this session.",
  },
  source: {
    id: "notification-session-1",
    eventType: "session_report_ready",
    entityId: "session-7",
    entityType: "AGENT_SESSION",
    entityTitle: "Pricing rollout review",
    affectedEntities: [],
    payload: {
      sessionId: "session-7",
      reportId: "report-session-1",
      sessionTitle: "Pricing rollout review",
      reportTitle: "Session Summary",
      reportType: "SESSION_SUMMARY",
    },
    createdAt: "2026-05-16T15:30:00.000Z",
    status: "unread",
  },
};

const featureSyncReportReadyFixture: NotificationRecord = {
  ...sessionReportReadyFixture,
  id: "notification-session-feature-sync" as NotificationRecord["id"],
  notificationId: "notification-session-feature-sync",
  reportId: "report-session-feature-sync",
  preview: {
    title: "Report ready",
    summary: "The agent has completed its feature analysis.",
  },
  source: {
    id: "notification-session-feature-sync",
    eventType: "session_report_ready",
    entityId: "session-9",
    entityType: "AGENT_SESSION",
    entityTitle: "Multiuser rollout sync",
    affectedEntities: [],
    payload: {
      sessionId: "session-9",
      reportId: "report-session-feature-sync",
      sessionTitle: "Multiuser rollout sync",
      reportTitle: "Feature Sync Analysis",
      reportType: "FEATURE_SYNC",
    },
    createdAt: "2026-05-16T15:30:00.000Z",
    status: "unread",
  },
};

const meta: Meta<typeof NotificationItem> = {
  title: "Components/Notifications/NotificationItem",
  component: NotificationItem,
  parameters: {
    layout: "padded",
  },
  args: {
    onAcknowledge: () => {},
    isUpdating: false,
  },
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={["/projects/project-42/dashboard"]}>
        <Box sx={{ maxWidth: 560 }}>
          <List disablePadding>
            <Story />
          </List>
        </Box>
      </MemoryRouter>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof NotificationItem>;

export const Unread: Story = {
  args: {
    notification: baseGenericFixture,
  },
};

export const Seen: Story = {
  args: {
    notification: {
      ...baseGenericFixture,
      status: "read",
      isRead: true,
      readAt: "2026-05-16T16:00:00.000Z",
    },
  },
};

export const Acknowledged: Story = {
  args: {
    notification: {
      ...baseGenericFixture,
      status: "acknowledged",
      isRead: true,
      isAcknowledged: true,
      readAt: "2026-05-16T16:00:00.000Z",
      acknowledgedAt: "2026-05-16T16:05:00.000Z",
    },
  },
};

export const SessionReportReady: Story = {
  args: {
    notification: sessionReportReadyFixture,
  },
};

export const SessionReportReadyFeatureSync: Story = {
  args: {
    notification: featureSyncReportReadyFixture,
  },
};

export const SessionReportReadyAcknowledged: Story = {
  args: {
    notification: {
      ...sessionReportReadyFixture,
      status: "acknowledged",
      isRead: true,
      isAcknowledged: true,
      readAt: "2026-05-16T16:00:00.000Z",
      acknowledgedAt: "2026-05-16T16:05:00.000Z",
    },
  },
};

export const Updating: Story = {
  args: {
    notification: baseGenericFixture,
    isUpdating: true,
  },
};

export const MixedList: Story = {
  render: (args) => (
    <>
      <NotificationItem {...args} notification={sessionReportReadyFixture} />
      <NotificationItem {...args} notification={baseGenericFixture} />
      <NotificationItem
        {...args}
        notification={{
          ...baseGenericFixture,
          id: "notification-generic-2" as NotificationRecord["id"],
          notificationId: "notification-generic-2",
          eventType: "task.completed",
          preview: {
            title: "Task completed",
            summary: "Implement notification dispatcher completed.",
          },
          status: "read",
          isRead: true,
          readAt: "2026-05-16T16:00:00.000Z",
        }}
      />
      <NotificationItem
        {...args}
        notification={{
          ...sessionReportReadyFixture,
          id: "notification-session-2" as NotificationRecord["id"],
          notificationId: "notification-session-2",
          status: "acknowledged",
          isRead: true,
          isAcknowledged: true,
          readAt: "2026-05-16T16:00:00.000Z",
          acknowledgedAt: "2026-05-16T16:05:00.000Z",
        }}
      />
    </>
  ),
};
