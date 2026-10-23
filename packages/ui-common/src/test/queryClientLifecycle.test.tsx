import { renderHook, waitFor } from "@testing-library/react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { afterAll, expect, it } from "vitest";

const clients = new Set<QueryClient>();
let started = false;
let aborted = false;

it("tracks an active query in the shared render wrapper", async () => {
  renderHook(() => {
    clients.add(useQueryClient());
    return useQuery({
      queryKey: ["shared-wrapper-lifecycle"],
      queryFn: ({ signal }) => {
        started = true;
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise<string>(() => {});
      },
    });
  });
  await waitFor(() => expect(started).toBe(true));
});

// Runs after the shared afterEach: a pending query must be aborted and its
// cache removed before MSW handlers or the environment are torn down.
afterAll(() => {
  expect(aborted).toBe(true);
  expect(clients.size).toBeGreaterThan(0);
  for (const client of clients)
    expect(client.getQueryCache().getAll()).toEqual([]);
});
