import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { activityKeys } from "../../collections/activityCorrelations";
import { act, renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { ActivitySleepDuration, EntityType } from "../../../api";
import { activityCorrelationClient } from "../../../clients/serviceClients";
import {
  useSleepActivityCorrelation,
  type SleepActivityCorrelationVariables,
} from "../useSleepActivityCorrelation";

vi.mock("../../../clients/serviceClients", () => ({
  activityCorrelationClient: {
    sleepActivityCorrelation: vi.fn(),
  },
}));

const client = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const mockSleepActivityCorrelation =
  activityCorrelationClient.sleepActivityCorrelation as Mock;

describe("useSleepActivityCorrelation", () => {
  const sleepResponse = {
    entityId: "task-1",
    entityType: EntityType.Task,
    duration: ActivitySleepDuration.OneHour,
    expiresAt: "2026-03-14T18:00:00.000Z",
  };

  const variables: SleepActivityCorrelationVariables = {
    organizationId: "org-1",
    entityId: "task-1",
    entityType: EntityType.Task,
    duration: ActivitySleepDuration.OneHour,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client.clear();
    mockSleepActivityCorrelation.mockResolvedValue({
      data: {
        success: true,
        message: "slept",
        data: sleepResponse,
      },
    });
  });

  it("sleeps an activity entity and marks correlated activity stale", async () => {
    const { result } = renderHook(() => useSleepActivityCorrelation(), {
      wrapper,
    });

    const key = activityKeys.correlated({
      organizationId: "org-1",
      entityType: EntityType.Task,
      entityId: "task-1",
    });
    const otherKey = activityKeys.correlated({
      organizationId: "other",
      entityType: EntityType.Task,
      entityId: "task-1",
    });
    client.setQueryData(key, {});
    client.setQueryData(otherKey, {});
    let response: unknown;
    await act(async () => {
      response = await result.current.mutate(variables);
    });

    expect(response).toEqual(sleepResponse);
    expect(mockSleepActivityCorrelation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: variables.organizationId,
        createActivitySleepDto: {
          entityId: variables.entityId,
          entityType: variables.entityType,
          duration: variables.duration,
        },
      })
    );
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it("throws when the sleep response lacks data", async () => {
    mockSleepActivityCorrelation.mockResolvedValue({
      data: {
        success: true,
        message: "slept",
      },
    });

    const { result } = renderHook(() => useSleepActivityCorrelation(), {
      wrapper,
    });

    await act(async () => {
      await expect(result.current.mutate(variables)).rejects.toThrow(
        "No activity sleep returned from sleep endpoint"
      );
    });
  });
});
