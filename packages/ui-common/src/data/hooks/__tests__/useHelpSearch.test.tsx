import { act, renderHook } from "@testing-library/react";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HelpSearchResponse,
  HelpSearchResult,
  SearchHelp200Response,
} from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { useHelpSearch } from "../useHelpSearch";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    searchHelp: vi.fn(),
  },
}));

const mockedClient = vi.mocked(unifiedApiClient);

const searchResults: HelpSearchResult[] = [
  {
    id: "help-node-1",
    slug: "features",
    title: "Features",
    snippet: "Features organize product capabilities.",
    rank: 0.91,
  },
  {
    id: "help-node-2",
    slug: "plans",
    title: "Plans",
    snippet: "Plans sequence implementation work.",
    rank: 0.72,
  },
];

const buildResponse = (
  data: HelpSearchResponse
): AxiosResponse<SearchHelp200Response> => ({
  data: {
    success: true,
    message: "OK",
    data,
    timestamp: "2026-07-06T00:00:00.000Z",
    statusCode: 200,
  },
  status: 200,
  statusText: "OK",
  headers: {},
  config: { headers: new AxiosHeaders() },
});

const advanceSearchDebounce = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
};

describe("useHelpSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces non-empty queries and exposes ranked help search results", async () => {
    mockedClient.searchHelp.mockResolvedValue(
      buildResponse({ results: searchResults })
    );

    const { result } = renderHook(() => useHelpSearch("  feature  "));

    expect(result.current.isLoading).toBe(true);
    expect(mockedClient.searchHelp).not.toHaveBeenCalled();

    await advanceSearchDebounce();

    expect(result.current.results).toEqual(searchResults);

    expect(mockedClient.searchHelp).toHaveBeenCalledTimes(1);
    expect(mockedClient.searchHelp).toHaveBeenCalledWith(
      expect.objectContaining({ q: "feature" })
    );
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("returns no matches and makes no request for blank queries", async () => {
    const { result } = renderHook(() => useHelpSearch("   "));

    await advanceSearchDebounce();

    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockedClient.searchHelp).not.toHaveBeenCalled();
  });

  it("clears previous results when the query becomes blank", async () => {
    mockedClient.searchHelp.mockResolvedValue(
      buildResponse({ results: searchResults })
    );

    const { result, rerender } = renderHook(
      ({ query }) => useHelpSearch(query),
      { initialProps: { query: "feature" } }
    );

    await advanceSearchDebounce();

    expect(result.current.results).toEqual(searchResults);

    rerender({ query: " " });

    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockedClient.searchHelp).toHaveBeenCalledTimes(1);
  });

  it("exposes loading while the request is in flight", async () => {
    let resolveRequest: (
      response: AxiosResponse<SearchHelp200Response>
    ) => void;
    const request = new Promise<AxiosResponse<SearchHelp200Response>>(
      (resolve) => {
        resolveRequest = resolve;
      }
    );
    mockedClient.searchHelp.mockReturnValue(request);

    const { result } = renderHook(() => useHelpSearch("feature"));

    expect(result.current.isLoading).toBe(true);

    await advanceSearchDebounce();

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveRequest!(buildResponse({ results: searchResults }));
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.results).toEqual(searchResults);
  });

  it("captures request errors and clears stale matches", async () => {
    const error = new Error("help search unavailable");
    mockedClient.searchHelp.mockResolvedValueOnce(
      buildResponse({ results: searchResults })
    );
    mockedClient.searchHelp.mockRejectedValueOnce(error);

    const { result, rerender } = renderHook(
      ({ query }) => useHelpSearch(query),
      { initialProps: { query: "feature" } }
    );

    await advanceSearchDebounce();

    expect(result.current.results).toEqual(searchResults);

    rerender({ query: "plan" });
    await advanceSearchDebounce();

    expect(result.current.error).toBe(error);

    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});
