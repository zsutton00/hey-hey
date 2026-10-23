import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCreateService } from "../useCreateService";
import { useServices } from "../useServices";
import { serviceKeys } from "../../collections/services";
import type { CreateServiceDto, ServiceDto } from "../../../api";

const { mockCreateService, request } = vi.hoisted(() => ({
  mockCreateService: vi.fn(),
  request: vi.fn(),
}));

vi.mock("../../../clients", () => ({
  dataClient: { request },
  getApiRuntime: () => ({
    clients: { services: { createService: mockCreateService } },
  }),
}));

const mockService = {
  id: "service-123",
  name: "Backend API",
  organizationId: "org-123",
  projectId: "project-123",
  status: "ACTIVE",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
} as unknown as ServiceDto;

const mockCreateDto = {
  name: "Backend API",
  projectId: "project-123",
} as unknown as CreateServiceDto;

const createdResponse = (data: unknown) => ({
  data: {
    success: true,
    message: "Service created successfully",
    data,
    timestamp: "2024-01-01T00:00:00Z",
    statusCode: 201,
    path: "/organizations/org-123/services",
  },
});

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

const variables = { organizationId: "org-123", service: mockCreateDto };

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateService.mockResolvedValue(createdResponse(mockService));
});

describe("useCreateService", () => {
  describe("successful creation", () => {
    it("creates the service, seeds its by-id read, and calls onSuccess", async () => {
      const onSuccess = vi.fn();
      const { wrapper, queryClient } = createHarness();
      const { result } = renderHook(() => useCreateService({ onSuccess }), {
        wrapper,
      });

      expect(result.current.isPending).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isError).toBe(false);
      expect(result.current.error).toBeNull();

      let created: ServiceDto | undefined;
      await act(async () => {
        created = await result.current.mutate(variables);
      });

      expect(created).toEqual(mockService);
      expect(mockCreateService).toHaveBeenCalledWith({
        organizationId: "org-123",
        createServiceDto: mockCreateDto,
      });
      expect(
        queryClient.getQueryData(serviceKeys.byId("org-123", "service-123"))
      ).toEqual(mockService);
      expect(onSuccess).toHaveBeenCalledWith(mockService);
    });

    it("invalidates the organization's service lists", async () => {
      const { wrapper, queryClient } = createHarness();
      queryClient.setQueryData(serviceKeys.list("org-123"), []);
      queryClient.setQueryData(serviceKeys.list("org-other"), []);
      const { result } = renderHook(() => useCreateService(), { wrapper });

      await act(async () => {
        await result.current.mutate(variables);
      });

      expect(
        queryClient.getQueryState(serviceKeys.list("org-123"))?.isInvalidated
      ).toBe(true);
      expect(
        queryClient.getQueryState(serviceKeys.list("org-other"))?.isInvalidated
      ).toBe(false);
    });

    it("causes exactly one re-read of a mounted service list", async () => {
      request
        .mockResolvedValueOnce({ data: { data: [] } })
        .mockResolvedValueOnce({ data: { data: [mockService] } });
      const { wrapper } = createHarness();
      const { result } = renderHook(
        () => ({
          list: useServices("org-123"),
          create: useCreateService(),
        }),
        { wrapper }
      );
      await waitFor(() => expect(result.current.list.isReady).toBe(true));
      expect(request).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.create.mutate(variables);
      });

      await waitFor(() =>
        expect(result.current.list.services).toEqual([mockService])
      );
      expect(request).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("rejects and calls onError with the API error", async () => {
      const error = new Error("Creation failed");
      const onError = vi.fn();
      mockCreateService.mockRejectedValue(error);
      const { wrapper } = createHarness();
      const { result } = renderHook(() => useCreateService({ onError }), {
        wrapper,
      });

      await act(async () => {
        await expect(result.current.mutate(variables)).rejects.toThrow(
          "Creation failed"
        );
      });

      expect(onError).toHaveBeenCalledWith(error);
    });

    it.each([
      ["null data", createdResponse(null)],
      ["missing data field", { data: { success: true } }],
    ])("rejects on %s in the response", async (_label, response) => {
      mockCreateService.mockResolvedValue(response);
      const { wrapper, queryClient } = createHarness();
      queryClient.setQueryData(serviceKeys.list("org-123"), []);
      const { result } = renderHook(() => useCreateService(), { wrapper });

      await act(async () => {
        await expect(result.current.mutate(variables)).rejects.toThrow(
          "No service returned from create endpoint"
        );
      });

      expect(
        queryClient.getQueryState(serviceKeys.list("org-123"))?.isInvalidated
      ).toBe(false);
    });
  });

  describe("state management", () => {
    it("returns idle initial state", () => {
      const { wrapper } = createHarness();
      const { result } = renderHook(() => useCreateService(), { wrapper });

      expect(result.current.isPending).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isError).toBe(false);
      expect(result.current.error).toBeNull();
      expect(typeof result.current.mutate).toBe("function");
    });

    it("calls onSettled on success and on error", async () => {
      const onSettled = vi.fn();
      const { wrapper } = createHarness();
      const { result } = renderHook(() => useCreateService({ onSettled }), {
        wrapper,
      });

      await act(async () => {
        await result.current.mutate(variables);
      });
      expect(onSettled).toHaveBeenCalledTimes(1);

      mockCreateService.mockRejectedValue(new Error("Test error"));
      await act(async () => {
        await expect(result.current.mutate(variables)).rejects.toThrow();
      });
      expect(onSettled).toHaveBeenCalledTimes(2);
    });
  });
});
