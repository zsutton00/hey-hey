import { renderHook, waitFor } from "@testing-library/react";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GetHelpTree200Response, HelpTreeResponse } from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { useHelpTree } from "../useHelpTree";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getHelpTree: vi.fn(),
  },
}));

const mockedClient = vi.mocked(unifiedApiClient);

const helpTree: HelpTreeResponse = {
  items: [
    {
      id: "root",
      parentId: null,
      slug: "root",
      title: "Root",
      ordering: 1,
    },
  ],
};

const buildResponse = (
  data: GetHelpTree200Response
): AxiosResponse<GetHelpTree200Response> => ({
  data,
  status: 200,
  statusText: "OK",
  headers: {},
  config: { headers: new AxiosHeaders() },
});

describe("useHelpTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the generated Help tree response", async () => {
    mockedClient.getHelpTree.mockResolvedValue(
      buildResponse({ data: helpTree })
    );

    const { result } = renderHook(() => useHelpTree());

    await waitFor(() => {
      expect(result.current.tree).toEqual(helpTree);
    });

    expect(mockedClient.getHelpTree).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("exposes loading while the request is in flight", async () => {
    let resolveRequest: (
      response: AxiosResponse<GetHelpTree200Response>
    ) => void;
    const request = new Promise<AxiosResponse<GetHelpTree200Response>>(
      (resolve) => {
        resolveRequest = resolve;
      }
    );
    mockedClient.getHelpTree.mockReturnValue(request);

    const { result } = renderHook(() => useHelpTree());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });

    resolveRequest!(buildResponse({ data: helpTree }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.tree).toEqual(helpTree);
  });

  it("captures request errors", async () => {
    const error = new Error("help tree unavailable");
    mockedClient.getHelpTree.mockRejectedValue(error);

    const { result } = renderHook(() => useHelpTree());

    await waitFor(() => {
      expect(result.current.error).toBe(error);
    });

    expect(result.current.tree).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
