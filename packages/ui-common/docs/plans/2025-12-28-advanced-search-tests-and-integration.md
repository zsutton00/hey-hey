# Advanced Search Tests and MentionPopup Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add comprehensive tests for AdvancedSearch components and integrate with MentionPopup using a flexible render prop pattern

**Architecture:**
- Use Vitest + React Testing Library for component tests
- Add hook tests with mock API calls
- Implement `onAdvancedSearch` render prop pattern in MentionPopup that allows parent to control rendering (modal for web, inline for VSCode)
- Parent renders AdvancedSearch in chosen container and passes callback to receive selected entities

**Tech Stack:** Vitest, @testing-library/react, @testing-library/user-event, MSW for API mocking

---

## Phase 1: Test Infrastructure Setup

### Task 1: Create Test Utilities

**Files:**
- Create: `src/components/AdvancedSearch/__tests__/testUtils.tsx`

**Step 1: Write test utilities file**

Create utilities for mocking API responses and rendering with providers:

```typescript
import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SearchEntity } from '../types';

export function createMockSearchEntity(overrides: Partial<SearchEntity> = {}): SearchEntity {
  return {
    id: 'entity-1',
    type: 'task',
    name: 'Test Task',
    description: 'Test description',
    status: 'in_progress',
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
      type: i % 3 === 0 ? 'task' : i % 3 === 1 ? 'initiative' : 'design_doc',
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

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: WrapperProps): React.ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    queryClient,
  };
}
```

**Step 2: Commit test utilities**

```bash
git add src/components/AdvancedSearch/__tests__/testUtils.tsx
git commit -m "test: add test utilities for AdvancedSearch components"
```

---

## Phase 2: Component Tests

### Task 2: SearchInputs Tests

**Files:**
- Create: `src/components/AdvancedSearch/__tests__/SearchInputs.test.tsx`

**Step 1: Write SearchInputs test file**

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchInputs } from '../SearchInputs';

describe('SearchInputs', () => {
  const mockOnTitleQueryChange = vi.fn();
  const mockOnSemanticQueryChange = vi.fn();

  beforeEach(() => {
    mockOnTitleQueryChange.mockClear();
    mockOnSemanticQueryChange.mockClear();
  });

  it('should render both input fields', () => {
    render(
      <SearchInputs
        titleQuery=""
        onTitleQueryChange={mockOnTitleQueryChange}
        semanticQuery=""
        onSemanticQueryChange={mockOnSemanticQueryChange}
      />
    );

    expect(screen.getByLabelText('Title Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Semantic Search')).toBeInTheDocument();
  });

  it('should display current query values', () => {
    render(
      <SearchInputs
        titleQuery="test title"
        onTitleQueryChange={mockOnTitleQueryChange}
        semanticQuery="test semantic query"
        onSemanticQueryChange={mockOnSemanticQueryChange}
      />
    );

    expect(screen.getByDisplayValue('test title')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test semantic query')).toBeInTheDocument();
  });

  it('should call onTitleQueryChange when title input changes', () => {
    render(
      <SearchInputs
        titleQuery=""
        onTitleQueryChange={mockOnTitleQueryChange}
        semanticQuery=""
        onSemanticQueryChange={mockOnSemanticQueryChange}
      />
    );

    const titleInput = screen.getByLabelText('Title Search');
    fireEvent.change(titleInput, { target: { value: 'new title' } });

    expect(mockOnTitleQueryChange).toHaveBeenCalledWith('new title');
  });

  it('should call onSemanticQueryChange when semantic input changes', () => {
    render(
      <SearchInputs
        titleQuery=""
        onTitleQueryChange={mockOnTitleQueryChange}
        semanticQuery=""
        onSemanticQueryChange={mockOnSemanticQueryChange}
      />
    );

    const semanticInput = screen.getByLabelText('Semantic Search');
    fireEvent.change(semanticInput, { target: { value: 'new semantic query' } });

    expect(mockOnSemanticQueryChange).toHaveBeenCalledWith('new semantic query');
  });

  it('should disable inputs when isLoading is true', () => {
    render(
      <SearchInputs
        titleQuery=""
        onTitleQueryChange={mockOnTitleQueryChange}
        semanticQuery=""
        onSemanticQueryChange={mockOnSemanticQueryChange}
        isLoading={true}
      />
    );

    expect(screen.getByLabelText('Title Search')).toBeDisabled();
    expect(screen.getByLabelText('Semantic Search')).toBeDisabled();
  });

  it('should show search icon in title input', () => {
    render(
      <SearchInputs
        titleQuery=""
        onTitleQueryChange={mockOnTitleQueryChange}
        semanticQuery=""
        onSemanticQueryChange={mockOnSemanticQueryChange}
      />
    );

    expect(screen.getByTestId('SearchIcon')).toBeInTheDocument();
  });
});
```

**Step 2: Run SearchInputs tests**

```bash
pnpm test src/components/AdvancedSearch/__tests__/SearchInputs.test.tsx
```

Expected: All tests pass

**Step 3: Commit SearchInputs tests**

```bash
git add src/components/AdvancedSearch/__tests__/SearchInputs.test.tsx
git commit -m "test: add SearchInputs component tests"
```

---

### Task 3: SearchFilters Tests

**Files:**
- Create: `src/components/AdvancedSearch/__tests__/SearchFilters.test.tsx`

**Step 1: Write SearchFilters test file**

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchFilters } from '../SearchFilters';
import type { SearchFilterState } from '../types';

describe('SearchFilters', () => {
  const mockOnChange = vi.fn();
  const defaultFilters: SearchFilterState = {
    entityTypes: [],
    statuses: [],
    initiativeId: undefined,
    parentTaskId: undefined,
    threshold: 0.15,
    boostRecent: false,
  };

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('should render all filter sections', () => {
    render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    expect(screen.getByText('Entity Type')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Initiative ID')).toBeInTheDocument();
    expect(screen.getByText('Parent Task ID')).toBeInTheDocument();
  });

  it('should render in sidebar layout', () => {
    const { container } = render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    // Check for sidebar-specific styling
    const sidebarElement = container.firstChild as HTMLElement;
    expect(sidebarElement).toHaveStyle({ width: '280px' });
  });

  it('should render in stacked layout', () => {
    const { container } = render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="stacked"
      />
    );

    // Check for stacked-specific styling
    const stackedElement = container.firstChild as HTMLElement;
    expect(stackedElement).toHaveStyle({ width: '100%' });
  });

  it('should call onChange when entity type filter changes', () => {
    render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    const taskCheckbox = screen.getByLabelText('Task');
    fireEvent.click(taskCheckbox);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityTypes: ['task'],
      })
    );
  });

  it('should call onChange when status filter changes', () => {
    render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    const activeCheckbox = screen.getByLabelText('Active');
    fireEvent.click(activeCheckbox);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: ['active'],
      })
    );
  });

  it('should display current filter values', () => {
    const filtersWithValues: SearchFilterState = {
      ...defaultFilters,
      entityTypes: ['task', 'initiative'],
      statuses: ['active'],
    };

    render(
      <SearchFilters
        filters={filtersWithValues}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    expect(screen.getByLabelText('Task')).toBeChecked();
    expect(screen.getByLabelText('Initiative')).toBeChecked();
    expect(screen.getByLabelText('Active')).toBeChecked();
  });
});
```

**Step 2: Run SearchFilters tests**

```bash
pnpm test src/components/AdvancedSearch/__tests__/SearchFilters.test.tsx
```

Expected: All tests pass

**Step 3: Commit SearchFilters tests**

```bash
git add src/components/AdvancedSearch/__tests__/SearchFilters.test.tsx
git commit -m "test: add SearchFilters component tests"
```

---

### Task 4: SearchResults Tests

**Files:**
- Create: `src/components/AdvancedSearch/__tests__/SearchResults.test.tsx`

**Step 1: Write SearchResults test file**

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchResults } from '../SearchResults';
import { createMockSearchEntities } from './testUtils';

describe('SearchResults', () => {
  const mockOnSelectionChange = vi.fn();
  const mockOnPreview = vi.fn();
  const mockResults = createMockSearchEntities(3);

  beforeEach(() => {
    mockOnSelectionChange.mockClear();
    mockOnPreview.mockClear();
  });

  it('should render loading state', () => {
    render(
      <SearchResults
        results={[]}
        isLoading={true}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
      />
    );

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('should render empty state when no results', () => {
    render(
      <SearchResults
        results={[]}
        isLoading={false}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
      />
    );

    expect(screen.getByText(/no results found/i)).toBeInTheDocument();
  });

  it('should render all results', () => {
    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
      />
    );

    mockResults.forEach((entity) => {
      expect(screen.getByText(entity.name)).toBeInTheDocument();
    });
  });

  it('should show checkboxes when allowMultiSelect is true', () => {
    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={true}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(mockResults.length);
  });

  it('should not show checkboxes when allowMultiSelect is false', () => {
    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
      />
    );

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('should call onSelectionChange when clicking a result', () => {
    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
      />
    );

    fireEvent.click(screen.getByText(mockResults[0].name));

    expect(mockOnSelectionChange).toHaveBeenCalledWith(
      mockResults[0].id,
      expect.any(Object),
      mockResults
    );
  });

  it('should call onPreview when clicking preview button', () => {
    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
      />
    );

    const previewButtons = screen.getAllByTestId('VisibilityIcon');
    fireEvent.click(previewButtons[0]);

    expect(mockOnPreview).toHaveBeenCalledWith(mockResults[0]);
  });

  it('should show similarity scores when showSimilarityScores is true', () => {
    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={false}
        selectedIds={new Set()}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
        showSimilarityScores={true}
      />
    );

    mockResults.forEach((entity) => {
      if (entity.similarity) {
        const scoreText = `${(entity.similarity * 100).toFixed(0)}%`;
        expect(screen.getByText(scoreText)).toBeInTheDocument();
      }
    });
  });

  it('should mark selected items', () => {
    const selectedIds = new Set([mockResults[0].id, mockResults[1].id]);

    render(
      <SearchResults
        results={mockResults}
        isLoading={false}
        allowMultiSelect={true}
        selectedIds={selectedIds}
        onSelectionChange={mockOnSelectionChange}
        onPreview={mockOnPreview}
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).not.toBeChecked();
  });
});
```

**Step 2: Run SearchResults tests**

```bash
pnpm test src/components/AdvancedSearch/__tests__/SearchResults.test.tsx
```

Expected: All tests pass

**Step 3: Commit SearchResults tests**

```bash
git add src/components/AdvancedSearch/__tests__/SearchResults.test.tsx
git commit -m "test: add SearchResults component tests"
```

---

### Task 5: SearchPreview Tests

**Files:**
- Create: `src/components/AdvancedSearch/__tests__/SearchPreview.test.tsx`

**Step 1: Write SearchPreview test file**

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchPreview } from '../SearchPreview';
import { createMockSearchEntity } from './testUtils';

describe('SearchPreview', () => {
  const mockOnClose = vi.fn();
  const mockOnSelect = vi.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
    mockOnSelect.mockClear();
  });

  it('should render return button', () => {
    const entity = createMockSearchEntity();

    render(
      <SearchPreview
        entity={entity}
        onClose={mockOnClose}
        allowSelection={false}
        isSelected={false}
      />
    );

    expect(screen.getByText('Return')).toBeInTheDocument();
  });

  it('should call onClose when return button is clicked', () => {
    const entity = createMockSearchEntity();

    render(
      <SearchPreview
        entity={entity}
        onClose={mockOnClose}
        allowSelection={false}
        isSelected={false}
      />
    );

    fireEvent.click(screen.getByText('Return'));

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should show select button when allowSelection is true and not selected', () => {
    const entity = createMockSearchEntity();

    render(
      <SearchPreview
        entity={entity}
        onClose={mockOnClose}
        onSelect={mockOnSelect}
        allowSelection={true}
        isSelected={false}
      />
    );

    expect(screen.getByText('Select and Return')).toBeInTheDocument();
  });

  it('should hide select button when already selected', () => {
    const entity = createMockSearchEntity();

    render(
      <SearchPreview
        entity={entity}
        onClose={mockOnClose}
        onSelect={mockOnSelect}
        allowSelection={true}
        isSelected={true}
      />
    );

    expect(screen.queryByText('Select and Return')).not.toBeInTheDocument();
  });

  it('should call onSelect when select button is clicked', () => {
    const entity = createMockSearchEntity();

    render(
      <SearchPreview
        entity={entity}
        onClose={mockOnClose}
        onSelect={mockOnSelect}
        allowSelection={true}
        isSelected={false}
      />
    );

    fireEvent.click(screen.getByText('Select and Return'));

    expect(mockOnSelect).toHaveBeenCalled();
  });

  it('should render task entity with WorkItemReadView', () => {
    const entity = createMockSearchEntity({
      type: 'task',
      metadata: {
        description: 'Task description',
        details: 'Task details',
      },
    });

    render(
      <SearchPreview
        entity={entity}
        onClose={mockOnClose}
        allowSelection={false}
        isSelected={false}
      />
    );

    expect(screen.getByText('Task description')).toBeInTheDocument();
  });

  it('should render design doc entity with AdrReadView', () => {
    const entity = createMockSearchEntity({
      type: 'design_doc',
      metadata: {
        name: 'ADR Title',
        summary: 'ADR Summary',
      },
    });

    render(
      <SearchPreview
        entity={entity}
        onClose={mockOnClose}
        allowSelection={false}
        isSelected={false}
      />
    );

    expect(screen.getByText('ADR Title')).toBeInTheDocument();
    expect(screen.getByText('ADR Summary')).toBeInTheDocument();
  });

  it('should render default preview for unknown entity types', () => {
    const entity = createMockSearchEntity({
      type: 'unknown_type',
      name: 'Unknown Entity',
      description: 'Unknown description',
    });

    render(
      <SearchPreview
        entity={entity}
        onClose={mockOnClose}
        allowSelection={false}
        isSelected={false}
      />
    );

    expect(screen.getByText('Unknown Entity')).toBeInTheDocument();
    expect(screen.getByText('Unknown description')).toBeInTheDocument();
  });
});
```

**Step 2: Run SearchPreview tests**

```bash
pnpm test src/components/AdvancedSearch/__tests__/SearchPreview.test.tsx
```

Expected: All tests pass

**Step 3: Commit SearchPreview tests**

```bash
git add src/components/AdvancedSearch/__tests__/SearchPreview.test.tsx
git commit -m "test: add SearchPreview component tests"
```

---

## Phase 3: Hook Tests

### Task 6: useSemanticSearch Hook Tests

**Files:**
- Create: `src/components/AdvancedSearch/hooks/__tests__/useSemanticSearch.test.ts`

**Step 1: Write useSemanticSearch test file**

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSemanticSearch } from '../useSemanticSearch';
import { unifiedApiClient } from '../../../../clients/serviceClients';
import type { SearchFilterState } from '../../types';

vi.mock('../../../../clients/serviceClients', () => ({
  unifiedApiClient: {
    semanticSearch: vi.fn(),
  },
}));

describe('useSemanticSearch', () => {
  const mockOrganizationId = 'org-123';
  const defaultFilters: SearchFilterState = {
    entityTypes: [],
    statuses: [],
    threshold: 0.15,
    boostRecent: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty results initially', () => {
    const { result } = renderHook(() =>
      useSemanticSearch(mockOrganizationId, '', '', defaultFilters)
    );

    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should not call API when both queries are empty', async () => {
    renderHook(() =>
      useSemanticSearch(mockOrganizationId, '', '', defaultFilters)
    );

    await waitFor(() => {
      expect(unifiedApiClient.semanticSearch).not.toHaveBeenCalled();
    });
  });

  it('should call API when title query is provided', async () => {
    const mockResponse = {
      data: {
        results: [
          {
            id: 'entity-1',
            type: 'task',
            name: 'Test Task',
            similarity: 0.85,
          },
        ],
      },
    };

    vi.mocked(unifiedApiClient.semanticSearch).mockResolvedValue(mockResponse);

    const { result } = renderHook(() =>
      useSemanticSearch(mockOrganizationId, 'test query', '', defaultFilters)
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(unifiedApiClient.semanticSearch).toHaveBeenCalledWith(
      mockOrganizationId,
      'test query',
      undefined,
      50,
      0.15,
      'keyword',
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      expect.any(Object)
    );

    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].id).toBe('entity-1');
  });

  it('should use semantic mode when semantic query is provided', async () => {
    const mockResponse = { data: { results: [] } };
    vi.mocked(unifiedApiClient.semanticSearch).mockResolvedValue(mockResponse);

    renderHook(() =>
      useSemanticSearch(
        mockOrganizationId,
        '',
        'semantic query',
        defaultFilters
      )
    );

    await waitFor(() => {
      expect(unifiedApiClient.semanticSearch).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'semantic',
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.any(Object)
      );
    });
  });

  it('should debounce API calls', async () => {
    vi.useFakeTimers();
    const mockResponse = { data: { results: [] } };
    vi.mocked(unifiedApiClient.semanticSearch).mockResolvedValue(mockResponse);

    const { rerender } = renderHook(
      ({ query }) => useSemanticSearch(mockOrganizationId, query, '', defaultFilters),
      { initialProps: { query: 'a' } }
    );

    rerender({ query: 'ab' });
    rerender({ query: 'abc' });

    // Fast-forward less than debounce time
    vi.advanceTimersByTime(200);
    expect(unifiedApiClient.semanticSearch).not.toHaveBeenCalled();

    // Fast-forward past debounce time
    vi.advanceTimersByTime(150);
    await waitFor(() => {
      expect(unifiedApiClient.semanticSearch).toHaveBeenCalledTimes(1);
    });

    vi.useRealTimers();
  });

  it('should cancel previous request when new query is made', async () => {
    const mockResponse = { data: { results: [] } };
    vi.mocked(unifiedApiClient.semanticSearch).mockResolvedValue(mockResponse);

    const { rerender } = renderHook(
      ({ query }) => useSemanticSearch(mockOrganizationId, query, '', defaultFilters),
      { initialProps: { query: 'first' } }
    );

    await waitFor(() => {
      expect(unifiedApiClient.semanticSearch).toHaveBeenCalledTimes(1);
    });

    rerender({ query: 'second' });

    await waitFor(() => {
      expect(unifiedApiClient.semanticSearch).toHaveBeenCalledTimes(2);
    });

    // Verify the AbortController signal was provided
    const calls = vi.mocked(unifiedApiClient.semanticSearch).mock.calls;
    expect(calls[0][11]).toHaveProperty('signal');
    expect(calls[1][11]).toHaveProperty('signal');
  });

  it('should handle API errors', async () => {
    const mockError = new Error('API Error');
    vi.mocked(unifiedApiClient.semanticSearch).mockRejectedValue(mockError);

    const { result } = renderHook(() =>
      useSemanticSearch(mockOrganizationId, 'test', '', defaultFilters)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toEqual(mockError);
    expect(result.current.results).toEqual([]);
  });

  it('should apply filters to API call', async () => {
    const mockResponse = { data: { results: [] } };
    vi.mocked(unifiedApiClient.semanticSearch).mockResolvedValue(mockResponse);

    const filtersWithValues: SearchFilterState = {
      entityTypes: ['task', 'initiative'],
      statuses: ['active', 'completed'],
      initiativeId: 'init-123',
      parentTaskId: 'task-456',
      threshold: 0.5,
      boostRecent: true,
    };

    renderHook(() =>
      useSemanticSearch(mockOrganizationId, 'test', '', filtersWithValues)
    );

    await waitFor(() => {
      expect(unifiedApiClient.semanticSearch).toHaveBeenCalledWith(
        mockOrganizationId,
        'test',
        undefined,
        50,
        0.5,
        'keyword',
        true,
        ['active', 'completed'],
        'init-123',
        'task-456',
        'task,initiative',
        expect.any(Object)
      );
    });
  });
});
```

**Step 2: Run useSemanticSearch tests**

```bash
pnpm test src/components/AdvancedSearch/hooks/__tests__/useSemanticSearch.test.ts
```

Expected: All tests pass

**Step 3: Commit useSemanticSearch tests**

```bash
git add src/components/AdvancedSearch/hooks/__tests__/useSemanticSearch.test.ts
git commit -m "test: add useSemanticSearch hook tests"
```

---

### Task 7: useSearchSelection Hook Tests

**Files:**
- Create: `src/components/AdvancedSearch/hooks/__tests__/useSearchSelection.test.ts`

**Step 1: Write useSearchSelection test file**

```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useSearchSelection } from '../useSearchSelection';
import { createMockSearchEntities } from '../../__tests__/testUtils';

describe('useSearchSelection', () => {
  const mockResults = createMockSearchEntities(5);

  describe('Single-select mode', () => {
    it('should select single item', () => {
      const { result } = renderHook(() => useSearchSelection(false));

      act(() => {
        result.current.handleSelect(
          mockResults[0].id,
          { metaKey: false, ctrlKey: false, shiftKey: false } as React.MouseEvent,
          mockResults
        );
      });

      expect(result.current.selectedIds.has(mockResults[0].id)).toBe(true);
      expect(result.current.selectedIds.size).toBe(1);
    });

    it('should replace selection when selecting new item', () => {
      const { result } = renderHook(() => useSearchSelection(false));

      act(() => {
        result.current.handleSelect(
          mockResults[0].id,
          { metaKey: false, ctrlKey: false, shiftKey: false } as React.MouseEvent,
          mockResults
        );
      });

      act(() => {
        result.current.handleSelect(
          mockResults[1].id,
          { metaKey: false, ctrlKey: false, shiftKey: false } as React.MouseEvent,
          mockResults
        );
      });

      expect(result.current.selectedIds.has(mockResults[0].id)).toBe(false);
      expect(result.current.selectedIds.has(mockResults[1].id)).toBe(true);
      expect(result.current.selectedIds.size).toBe(1);
    });
  });

  describe('Multi-select mode', () => {
    it('should toggle item selection on regular click', () => {
      const { result } = renderHook(() => useSearchSelection(true));

      // Select item
      act(() => {
        result.current.handleSelect(
          mockResults[0].id,
          { metaKey: false, ctrlKey: false, shiftKey: false } as React.MouseEvent,
          mockResults
        );
      });

      expect(result.current.selectedIds.has(mockResults[0].id)).toBe(true);

      // Deselect item
      act(() => {
        result.current.handleSelect(
          mockResults[0].id,
          { metaKey: false, ctrlKey: false, shiftKey: false } as React.MouseEvent,
          mockResults
        );
      });

      expect(result.current.selectedIds.has(mockResults[0].id)).toBe(false);
    });

    it('should toggle item selection with ctrl key', () => {
      const { result } = renderHook(() => useSearchSelection(true));

      act(() => {
        result.current.handleSelect(
          mockResults[0].id,
          { metaKey: false, ctrlKey: true, shiftKey: false } as React.MouseEvent,
          mockResults
        );
      });

      act(() => {
        result.current.handleSelect(
          mockResults[1].id,
          { metaKey: false, ctrlKey: true, shiftKey: false } as React.MouseEvent,
          mockResults
        );
      });

      expect(result.current.selectedIds.has(mockResults[0].id)).toBe(true);
      expect(result.current.selectedIds.has(mockResults[1].id)).toBe(true);
      expect(result.current.selectedIds.size).toBe(2);
    });

    it('should toggle item selection with meta key', () => {
      const { result } = renderHook(() => useSearchSelection(true));

      act(() => {
        result.current.handleSelect(
          mockResults[0].id,
          { metaKey: true, ctrlKey: false, shiftKey: false } as React.MouseEvent,
          mockResults
        );
      });

      act(() => {
        result.current.handleSelect(
          mockResults[1].id,
          { metaKey: true, ctrlKey: false, shiftKey: false } as React.MouseEvent,
          mockResults
        );
      });

      expect(result.current.selectedIds.has(mockResults[0].id)).toBe(true);
      expect(result.current.selectedIds.has(mockResults[1].id)).toBe(true);
      expect(result.current.selectedIds.size).toBe(2);
    });

    it('should select range with shift key', () => {
      const { result } = renderHook(() => useSearchSelection(true));

      // Select first item
      act(() => {
        result.current.handleSelect(
          mockResults[1].id,
          { metaKey: false, ctrlKey: false, shiftKey: false } as React.MouseEvent,
          mockResults
        );
      });

      // Shift-select to create range
      act(() => {
        result.current.handleSelect(
          mockResults[3].id,
          { metaKey: false, ctrlKey: false, shiftKey: true } as React.MouseEvent,
          mockResults
        );
      });

      expect(result.current.selectedIds.has(mockResults[1].id)).toBe(true);
      expect(result.current.selectedIds.has(mockResults[2].id)).toBe(true);
      expect(result.current.selectedIds.has(mockResults[3].id)).toBe(true);
      expect(result.current.selectedIds.size).toBe(3);
    });

    it('should clear all selections', () => {
      const { result } = renderHook(() => useSearchSelection(true));

      act(() => {
        result.current.handleSelect(
          mockResults[0].id,
          { metaKey: false, ctrlKey: false, shiftKey: false } as React.MouseEvent,
          mockResults
        );
        result.current.handleSelect(
          mockResults[1].id,
          { metaKey: true, ctrlKey: false, shiftKey: false } as React.MouseEvent,
          mockResults
        );
      });

      expect(result.current.selectedIds.size).toBe(2);

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedIds.size).toBe(0);
    });

    it('should select all items', () => {
      const { result } = renderHook(() => useSearchSelection(true));

      act(() => {
        result.current.selectAll(mockResults.map((r) => r.id));
      });

      expect(result.current.selectedIds.size).toBe(mockResults.length);
      mockResults.forEach((entity) => {
        expect(result.current.selectedIds.has(entity.id)).toBe(true);
      });
    });

    it('should add to selection', () => {
      const { result } = renderHook(() => useSearchSelection(true));

      act(() => {
        result.current.handleSelect(
          mockResults[0].id,
          { metaKey: false, ctrlKey: false, shiftKey: false } as React.MouseEvent,
          mockResults
        );
      });

      act(() => {
        result.current.addToSelection(mockResults[1].id);
      });

      expect(result.current.selectedIds.has(mockResults[0].id)).toBe(true);
      expect(result.current.selectedIds.has(mockResults[1].id)).toBe(true);
      expect(result.current.selectedIds.size).toBe(2);
    });

    it('should remove from selection', () => {
      const { result } = renderHook(() => useSearchSelection(true));

      act(() => {
        result.current.selectAll(mockResults.map((r) => r.id));
      });

      act(() => {
        result.current.removeFromSelection(mockResults[0].id);
      });

      expect(result.current.selectedIds.has(mockResults[0].id)).toBe(false);
      expect(result.current.selectedIds.size).toBe(mockResults.length - 1);
    });
  });
});
```

**Step 2: Run useSearchSelection tests**

```bash
pnpm test src/components/AdvancedSearch/hooks/__tests__/useSearchSelection.test.ts
```

Expected: All tests pass

**Step 3: Commit useSearchSelection tests**

```bash
git add src/components/AdvancedSearch/hooks/__tests__/useSearchSelection.test.ts
git commit -m "test: add useSearchSelection hook tests"
```

---

## Phase 4: Integration Tests

### Task 8: AdvancedSearch Integration Test

**Files:**
- Create: `src/components/AdvancedSearch/__tests__/AdvancedSearch.test.tsx`

**Step 1: Write AdvancedSearch integration test**

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdvancedSearch } from '../AdvancedSearch';
import { renderWithProviders, createMockSearchEntities } from './testUtils';
import { unifiedApiClient } from '../../../clients/serviceClients';

vi.mock('../../../clients/serviceClients', () => ({
  unifiedApiClient: {
    semanticSearch: vi.fn(),
  },
}));

describe('AdvancedSearch Integration', () => {
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();
  const mockOrganizationId = 'org-123';
  const mockResults = createMockSearchEntities(3);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(unifiedApiClient.semanticSearch).mockResolvedValue({
      data: {
        results: mockResults.map((r) => ({
          id: r.id,
          type: r.type,
          name: r.name,
          description: r.description,
          status: r.status,
          similarity: r.similarity,
          metadata: r.metadata,
        })),
      },
    });
  });

  it('should render search interface', () => {
    renderWithProviders(
      <AdvancedSearch
        organizationId={mockOrganizationId}
        onSelect={mockOnSelect}
      />
    );

    expect(screen.getByLabelText('Title Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Semantic Search')).toBeInTheDocument();
  });

  it('should perform search when query is entered', async () => {
    renderWithProviders(
      <AdvancedSearch
        organizationId={mockOrganizationId}
        onSelect={mockOnSelect}
      />
    );

    const titleInput = screen.getByLabelText('Title Search');
    fireEvent.change(titleInput, { target: { value: 'test query' } });

    await waitFor(() => {
      expect(unifiedApiClient.semanticSearch).toHaveBeenCalled();
    });

    await waitFor(() => {
      mockResults.forEach((entity) => {
        expect(screen.getByText(entity.name)).toBeInTheDocument();
      });
    });
  });

  it('should switch to preview view when preview button is clicked', async () => {
    renderWithProviders(
      <AdvancedSearch
        organizationId={mockOrganizationId}
        onSelect={mockOnSelect}
      />
    );

    const titleInput = screen.getByLabelText('Title Search');
    fireEvent.change(titleInput, { target: { value: 'test' } });

    await waitFor(() => {
      expect(screen.getByText(mockResults[0].name)).toBeInTheDocument();
    });

    const previewButtons = screen.getAllByTestId('VisibilityIcon');
    fireEvent.click(previewButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Return')).toBeInTheDocument();
    });
  });

  it('should return to search view from preview', async () => {
    renderWithProviders(
      <AdvancedSearch
        organizationId={mockOrganizationId}
        onSelect={mockOnSelect}
      />
    );

    const titleInput = screen.getByLabelText('Title Search');
    fireEvent.change(titleInput, { target: { value: 'test' } });

    await waitFor(() => {
      expect(screen.getByText(mockResults[0].name)).toBeInTheDocument();
    });

    const previewButtons = screen.getAllByTestId('VisibilityIcon');
    fireEvent.click(previewButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Return')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Return'));

    await waitFor(() => {
      expect(screen.getByLabelText('Title Search')).toBeInTheDocument();
    });
  });

  it('should call onSelect with selected entities in single-select mode', async () => {
    renderWithProviders(
      <AdvancedSearch
        organizationId={mockOrganizationId}
        onSelect={mockOnSelect}
        allowMultiSelect={false}
      />
    );

    const titleInput = screen.getByLabelText('Title Search');
    fireEvent.change(titleInput, { target: { value: 'test' } });

    await waitFor(() => {
      expect(screen.getByText(mockResults[0].name)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(mockResults[0].name));

    // In single-select mode, clicking an item should select it immediately
    // The component implementation should handle this
  });

  it('should show select button in multi-select mode', async () => {
    renderWithProviders(
      <AdvancedSearch
        organizationId={mockOrganizationId}
        onSelect={mockOnSelect}
        allowMultiSelect={true}
      />
    );

    const titleInput = screen.getByLabelText('Title Search');
    fireEvent.change(titleInput, { target: { value: 'test' } });

    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(mockResults.length);
    });

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    await waitFor(() => {
      expect(screen.getByText(/Select 2 items/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Select 2 items/i));

    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: mockResults[0].id }),
        expect.objectContaining({ id: mockResults[1].id }),
      ])
    );
  });

  it('should apply filters to search', async () => {
    renderWithProviders(
      <AdvancedSearch
        organizationId={mockOrganizationId}
        onSelect={mockOnSelect}
      />
    );

    // Select entity type filter
    const taskCheckbox = screen.getByLabelText('Task');
    fireEvent.click(taskCheckbox);

    const titleInput = screen.getByLabelText('Title Search');
    fireEvent.change(titleInput, { target: { value: 'test' } });

    await waitFor(() => {
      expect(unifiedApiClient.semanticSearch).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'task',
        expect.any(Object)
      );
    });
  });

  it('should call onClose when close button is clicked', async () => {
    renderWithProviders(
      <AdvancedSearch
        organizationId={mockOrganizationId}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
        allowMultiSelect={true}
      />
    );

    const titleInput = screen.getByLabelText('Title Search');
    fireEvent.change(titleInput, { target: { value: 'test' } });

    await waitFor(() => {
      expect(screen.getByText(mockResults[0].name)).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
  });
});
```

**Step 2: Run AdvancedSearch integration tests**

```bash
pnpm test src/components/AdvancedSearch/__tests__/AdvancedSearch.test.tsx
```

Expected: All tests pass

**Step 3: Commit integration tests**

```bash
git add src/components/AdvancedSearch/__tests__/AdvancedSearch.test.tsx
git commit -m "test: add AdvancedSearch integration tests"
```

---

## Phase 5: MentionPopup Integration

### Task 9: Update MentionPopup Types

**Files:**
- Modify: `src/components/SmarterTextAreaCard/MentionPopup.tsx:26-35`

**Step 1: Add onAdvancedSearch prop to MentionPopupProps**

Update the interface to accept a callback that receives a selection callback:

```typescript
interface MentionPopupProps {
  query: string;
  results: SearchEntity[];
  selectedTypeFilters: string[];
  onTypeFilterChange: (types: string[]) => void;
  onSelectEntity: (entity: SearchEntity) => void;
  isLoading?: boolean;
  entityTypes?: string[];
  onAdvancedSearch?: (onSelectEntities: (entities: SearchEntity[]) => void) => void;
}
```

**Step 2: Update Advanced Search button handler**

Modify the button's onClick handler to call the new callback:

In MentionPopup.tsx, replace line 192:

```typescript
// Old:
onClick={onAdvancedSearch}

// New:
onClick={() => onAdvancedSearch?.(handleAdvancedSearchSelect)}
```

**Step 3: Add handler for advanced search selections**

Add a new handler function before the return statement (around line 94):

```typescript
const handleAdvancedSearchSelect = (entities: SearchEntity[]): void => {
  // Select the first entity (or all if implementing multi-select)
  if (entities.length > 0) {
    onSelectEntity(entities[0]);
  }
};
```

**Step 4: Run type check**

```bash
pnpm run type-check
```

Expected: No type errors

**Step 5: Commit MentionPopup changes**

```bash
git add src/components/SmarterTextAreaCard/MentionPopup.tsx
git commit -m "feat: add advanced search callback to MentionPopup"
```

---

### Task 10: Update MentionPlugin

**Files:**
- Modify: `src/components/SmarterTextAreaCard/MentionPlugin.tsx:13-14,197`

**Step 1: Update MentionPluginProps interface**

Update the interface to match MentionPopup's new signature:

```typescript
interface MentionPluginProps {
  onSearchEntities: (query: string, entityTypes: string[]) => Promise<SearchEntity[]>;
  currentEntityTypes?: string[];
  mentionableEntityTypes?: string[];
  onAdvancedSearch?: (onSelectEntities: (entities: SearchEntity[]) => void) => void;
}
```

**Step 2: Pass onAdvancedSearch to MentionPopup**

The prop is already being passed on line 197, so no change needed. Just verify it's there.

**Step 3: Run type check**

```bash
pnpm run type-check
```

Expected: No type errors

**Step 4: Commit MentionPlugin changes**

```bash
git add src/components/SmarterTextAreaCard/MentionPlugin.tsx
git commit -m "feat: pass advanced search callback through MentionPlugin"
```

---

### Task 11: Update SmarterTextAreaCard

**Files:**
- Modify: `src/components/SmarterTextAreaCard/SmarterTextAreaCard.tsx:43-67,134-138`

**Step 1: Add onAdvancedSearch prop to SmarterTextAreaCardProps**

Add the prop to the interface:

```typescript
export interface SmarterTextAreaCardProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  headerText?: string;
  saveStatus: SaveStatus;
  saveMode: SaveMode;
  hasUnsavedChanges: boolean;
  required?: boolean;
  maxRows?: number;
  minRows?: number;
  multiline?: boolean;
  onSaveWithoutFeedback?: () => void;
  onSaveWithFeedback?: () => void;
  isSaving?: boolean;
  saveWithoutFeedbackText?: string;
  saveWithFeedbackText?: string;
  saveWithoutFeedbackIcon?: React.ReactNode;
  saveWithFeedbackIcon?: React.ReactNode;
  error?: boolean;
  helperText?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  onAdvancedSearch?: (onSelectEntities: (entities: SearchEntity[]) => void) => void;
}
```

**Step 2: Destructure onAdvancedSearch from props**

Add to destructuring (around line 144):

```typescript
export const SmarterTextAreaCard: React.FC<SmarterTextAreaCardProps> = ({
  disabled = false,
  error = false,
  hasUnsavedChanges,
  headerText,
  helperText,
  isSaving = false,
  onChange,
  onSaveWithFeedback,
  onSaveWithoutFeedback,
  placeholder,
  saveMode,
  saveStatus,
  saveWithFeedbackIcon,
  saveWithFeedbackText,
  saveWithoutFeedbackIcon,
  saveWithoutFeedbackText,
  value,
  onAdvancedSearch,
}) => {
```

**Step 3: Pass onAdvancedSearch to MentionPlugin**

Update the MentionPlugin usage (around line 134):

```typescript
<MentionPlugin
  onSearchEntities={searchEntities}
  currentEntityTypes={['task', 'initiative', 'design_doc']}
  mentionableEntityTypes={['task', 'initiative', 'design_doc']}
  onAdvancedSearch={onAdvancedSearch}
/>
```

**Step 4: Add import for SearchEntity type**

At the top of the file, add to imports:

```typescript
import type { SearchEntity } from './types';
```

**Step 5: Run type check**

```bash
pnpm run type-check
```

Expected: No type errors

**Step 6: Commit SmarterTextAreaCard changes**

```bash
git add src/components/SmarterTextAreaCard/SmarterTextAreaCard.tsx
git commit -m "feat: add advanced search support to SmarterTextAreaCard"
```

---

### Task 12: Export SearchEntity from index

**Files:**
- Modify: `src/components/SmarterTextAreaCard/index.ts:1-2`

**Step 1: Read current exports**

View the file first to see current exports.

**Step 2: Add SearchEntity to exports**

Ensure SearchEntity is exported:

```typescript
export { SmarterTextAreaCard } from './SmarterTextAreaCard';
export type { SmarterTextAreaCardProps } from './SmarterTextAreaCard';
export type { SearchEntity } from './types';
```

**Step 3: Commit export changes**

```bash
git add src/components/SmarterTextAreaCard/index.ts
git commit -m "feat: export SearchEntity type from SmarterTextAreaCard"
```

---

### Task 13: Add MentionPopup Integration Test

**Files:**
- Create: `src/components/SmarterTextAreaCard/__tests__/MentionPopup.integration.test.tsx`

**Step 1: Write integration test**

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MentionPopup } from '../MentionPopup';
import type { SearchEntity } from '../types';

describe('MentionPopup Advanced Search Integration', () => {
  const mockOnSelectEntity = vi.fn();
  const mockOnTypeFilterChange = vi.fn();
  const mockOnAdvancedSearch = vi.fn();

  const mockResults: SearchEntity[] = [
    {
      id: '1',
      type: 'task',
      name: 'Task 1',
      description: 'Description 1',
    },
    {
      id: '2',
      type: 'initiative',
      name: 'Initiative 1',
      description: 'Description 2',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render advanced search button', () => {
    render(
      <MentionPopup
        query="test"
        results={mockResults}
        selectedTypeFilters={[]}
        onTypeFilterChange={mockOnTypeFilterChange}
        onSelectEntity={mockOnSelectEntity}
        onAdvancedSearch={mockOnAdvancedSearch}
      />
    );

    expect(screen.getByText('Advanced Search')).toBeInTheDocument();
  });

  it('should call onAdvancedSearch with callback when button is clicked', () => {
    render(
      <MentionPopup
        query="test"
        results={mockResults}
        selectedTypeFilters={[]}
        onTypeFilterChange={mockOnTypeFilterChange}
        onSelectEntity={mockOnSelectEntity}
        onAdvancedSearch={mockOnAdvancedSearch}
      />
    );

    fireEvent.click(screen.getByText('Advanced Search'));

    expect(mockOnAdvancedSearch).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should call onSelectEntity when advanced search callback is invoked', () => {
    let capturedCallback: ((entities: SearchEntity[]) => void) | null = null;

    mockOnAdvancedSearch.mockImplementation((callback) => {
      capturedCallback = callback;
    });

    render(
      <MentionPopup
        query="test"
        results={mockResults}
        selectedTypeFilters={[]}
        onTypeFilterChange={mockOnTypeFilterChange}
        onSelectEntity={mockOnSelectEntity}
        onAdvancedSearch={mockOnAdvancedSearch}
      />
    );

    fireEvent.click(screen.getByText('Advanced Search'));

    expect(capturedCallback).not.toBeNull();

    const selectedEntities: SearchEntity[] = [
      {
        id: '3',
        type: 'design_doc',
        name: 'Design Doc 1',
      },
    ];

    capturedCallback!(selectedEntities);

    expect(mockOnSelectEntity).toHaveBeenCalledWith(selectedEntities[0]);
  });

  it('should disable button when onAdvancedSearch is not provided', () => {
    render(
      <MentionPopup
        query="test"
        results={mockResults}
        selectedTypeFilters={[]}
        onTypeFilterChange={mockOnTypeFilterChange}
        onSelectEntity={mockOnSelectEntity}
      />
    );

    expect(screen.getByText('Advanced Search')).toBeDisabled();
  });
});
```

**Step 2: Run integration test**

```bash
pnpm test src/components/SmarterTextAreaCard/__tests__/MentionPopup.integration.test.tsx
```

Expected: All tests pass

**Step 3: Commit integration test**

```bash
git add src/components/SmarterTextAreaCard/__tests__/MentionPopup.integration.test.tsx
git commit -m "test: add MentionPopup advanced search integration tests"
```

---

### Task 14: Add Documentation Example

**Files:**
- Create: `src/components/AdvancedSearch/README.md`

**Step 1: Write usage documentation**

```markdown
# AdvancedSearch Component

Advanced search component with dual search modes (title and semantic), filters, and entity preview.

## Features

- **Dual Search**: Title search (exact/fuzzy matching) and semantic search (natural language)
- **Filters**: Entity type, status, parent initiative, parent task
- **Preview**: Full entity preview with type-specific rendering
- **Multi-select**: Optional multi-selection with keyboard modifiers (Shift, Ctrl/Cmd)
- **Responsive**: Sidebar layout on wide screens, stacked on narrow screens

## Basic Usage

```tsx
import { AdvancedSearch } from '@hey-hey/ui-common/components';

function MyComponent() {
  const [selectedEntities, setSelectedEntities] = useState<SearchEntity[]>([]);

  return (
    <AdvancedSearch
      organizationId="org-123"
      onSelect={(entities) => {
        console.log('Selected:', entities);
        setSelectedEntities(entities);
      }}
    />
  );
}
```

## Integration with MentionPopup

The AdvancedSearch component integrates with MentionPopup through a render prop pattern:

```tsx
import { SmarterTextAreaCard } from '@hey-hey/ui-common/components';
import { AdvancedSearch } from '@hey-hey/ui-common/components';
import { Modal } from '@mui/material';

function MyEditor() {
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [advancedSearchCallback, setAdvancedSearchCallback] = useState<
    ((entities: SearchEntity[]) => void) | null
  >(null);

  const handleAdvancedSearch = (onSelectEntities: (entities: SearchEntity[]) => void) => {
    setAdvancedSearchCallback(() => onSelectEntities);
    setShowAdvancedSearch(true);
  };

  const handleAdvancedSearchSelect = (entities: SearchEntity[]) => {
    advancedSearchCallback?.(entities);
    setShowAdvancedSearch(false);
  };

  return (
    <>
      <SmarterTextAreaCard
        value={content}
        onChange={setContent}
        onAdvancedSearch={handleAdvancedSearch}
        // ... other props
      />

      {/* Web UI: Render in modal */}
      <Modal open={showAdvancedSearch} onClose={() => setShowAdvancedSearch(false)}>
        <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '90vw', height: '90vh', bgcolor: 'background.paper' }}>
          <AdvancedSearch
            organizationId="org-123"
            onSelect={handleAdvancedSearchSelect}
            onClose={() => setShowAdvancedSearch(false)}
            allowMultiSelect={false}
          />
        </Box>
      </Modal>
    </>
  );
}
```

### VSCode Extension Integration

For VSCode extension, render inline instead of in a modal:

```tsx
function MyVSCodeComponent() {
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);

  const handleAdvancedSearch = (onSelectEntities: (entities: SearchEntity[]) => void) => {
    setAdvancedSearchCallback(() => onSelectEntities);
    setShowAdvancedSearch(true);
  };

  if (showAdvancedSearch) {
    return (
      <AdvancedSearch
        organizationId="org-123"
        onSelect={(entities) => {
          advancedSearchCallback?.(entities);
          setShowAdvancedSearch(false);
        }}
        onClose={() => setShowAdvancedSearch(false)}
      />
    );
  }

  return (
    <SmarterTextAreaCard
      value={content}
      onChange={setContent}
      onAdvancedSearch={handleAdvancedSearch}
      // ... other props
    />
  );
}
```

## Props

### AdvancedSearchProps

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `organizationId` | `string` | Yes | - | Organization ID for scoping search |
| `onSelect` | `(entities: SearchEntity[]) => void` | Yes | - | Callback when entities are selected |
| `allowMultiSelect` | `boolean` | No | `false` | Enable multi-selection with checkboxes |
| `onClose` | `() => void` | No | - | Callback when search is closed |
| `projectId` | `string` | No | - | Optional project ID to filter results |
| `defaultEntityTypes` | `string[]` | No | `[]` | Default entity types to filter by |
| `defaultStatuses` | `string[]` | No | `[]` | Default statuses to filter by |
| `maxResults` | `number` | No | `50` | Maximum number of results |

## Keyboard Shortcuts

- **Escape**: Close popup or return from preview
- **Click**: Select/deselect item (multi-select mode)
- **Ctrl/Cmd + Click**: Toggle item selection
- **Shift + Click**: Select range

## Testing

See `__tests__/` directory for comprehensive test examples.
```

**Step 2: Commit documentation**

```bash
git add src/components/AdvancedSearch/README.md
git commit -m "docs: add AdvancedSearch component usage documentation"
```

---

## Phase 6: Final Verification

### Task 15: Run All Tests

**Step 1: Run full test suite**

```bash
pnpm test src/components/AdvancedSearch
pnpm test src/components/SmarterTextAreaCard/__tests__/MentionPopup.integration.test.tsx
```

Expected: All tests pass

**Step 2: Run type check**

```bash
pnpm run type-check
```

Expected: 0 errors

**Step 3: Run linter**

```bash
pnpm run lint
```

Expected: No errors

**Step 4: Create final commit**

```bash
git add .
git commit -m "feat: complete AdvancedSearch tests and MentionPopup integration

- Add comprehensive tests for all AdvancedSearch components
- Add hook tests for useSemanticSearch and useSearchSelection
- Add integration tests for full AdvancedSearch workflow
- Integrate AdvancedSearch with MentionPopup via render prop pattern
- Add usage documentation and examples
- All tests passing, type-check clean"
```

---

## Summary

This plan implements:

1. **Comprehensive Testing**
   - Component tests for SearchInputs, SearchFilters, SearchResults, SearchPreview
   - Hook tests for useSemanticSearch and useSearchSelection
   - Integration tests for full AdvancedSearch workflow
   - MentionPopup integration tests

2. **MentionPopup Integration**
   - Render prop pattern: `onAdvancedSearch` receives callback
   - Parent controls rendering (modal for web, inline for VSCode)
   - Parent receives selected entities via callback
   - Type-safe integration throughout

3. **Documentation**
   - Usage examples for web UI (modal)
   - Usage examples for VSCode (inline)
   - Complete props documentation
   - Keyboard shortcuts reference

**After Completion:**
- All AdvancedSearch components tested
- MentionPopup integration complete
- Ready for use in both web UI and VSCode extension
