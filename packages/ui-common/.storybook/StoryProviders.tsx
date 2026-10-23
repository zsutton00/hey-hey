import { useMemo, type ReactNode } from "react";
import type { StoryContext } from "@storybook/react";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { HeyThemeProvider } from "../src/contexts/ThemeContext";
import { ProjectContext } from "../src/contexts/ProjectContext";
import { DataHooksProvider } from "../src/data/DataHooksProvider";
import { storybookProjectContextValue } from "./fixtures/projectContext";

export interface StoryQueryDataEntry {
  queryKey: QueryKey;
  data: unknown;
}

export interface StoryProvidersProps {
  children: ReactNode;
  queryData?: ReadonlyArray<StoryQueryDataEntry>;
}

const failingDefaultQueryFn = async ({ queryKey }: { queryKey: QueryKey }) => {
  throw new Error(
    `[Storybook] Unseeded react-query fetch for ${JSON.stringify(
      queryKey
    )}. Seed fixture data via the \`queryData\` story parameter — stories must not hit live APIs.`
  );
};

export const StoryProviders = ({
  children,
  queryData,
}: StoryProvidersProps) => {
  const queryClient = useMemo(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
          queryFn: failingDefaultQueryFn,
        },
        mutations: {
          retry: false,
        },
      },
    });
    if (queryData) {
      for (const entry of queryData) {
        client.setQueryData(entry.queryKey, entry.data);
      }
    }
    return client;
  }, [queryData]);

  return (
    <MemoryRouter>
      <HeyThemeProvider>
        <ProjectContext.Provider value={storybookProjectContextValue}>
          <DataHooksProvider queryClient={queryClient}>
            {children}
          </DataHooksProvider>
        </ProjectContext.Provider>
      </HeyThemeProvider>
    </MemoryRouter>
  );
};

export const readQueryDataFromStoryContext = (
  context: StoryContext
): ReadonlyArray<StoryQueryDataEntry> | undefined => {
  const value = context.parameters?.queryData;
  if (!value) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(
      "[Storybook] `parameters.queryData` must be an array of { queryKey, data } pairs."
    );
  }
  return value as ReadonlyArray<StoryQueryDataEntry>;
};
