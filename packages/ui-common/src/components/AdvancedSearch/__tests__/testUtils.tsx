import React from "react";
import {
  render,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { SearchEntity } from "../types";

export function createMockSearchEntity(
  overrides: Partial<SearchEntity> = {}
): SearchEntity {
  return {
    id: "entity-1",
    type: "TASK",
    name: "Test Task",
    description: "Test description",
    status: "in_progress",
    similarity: 0.85,
    metadata: {},
    ...overrides,
  };
}

export function createMockSearchEntities(count: number): SearchEntity[] {
  return Array.from({ length: count }, (_, i) =>
    createMockSearchEntity({
      id: `entity-${i + 1}`,
      name: `Test Entity ${i + 1}`,
      type: i % 3 === 0 ? "TASK" : i % 3 === 1 ? "INITIATIVE" : "DESIGN_DOC",
    })
  );
}

interface WrapperProps {
  children: React.ReactNode;
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

const theme = createTheme();

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper">
): RenderResult & { queryClient: QueryClient } {
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: WrapperProps): React.ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>{children}</ThemeProvider>
      </QueryClientProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    queryClient,
  };
}
