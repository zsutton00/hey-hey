# AdvancedSearch

Full-featured search interface with title search, semantic search, optional caller-provided scopes, entity preview, and selection capabilities.

> **Integration Guide**: For information on integrating AdvancedSearch with the modal system, see the [Modal System README](../../contexts/ModalSystem.README.md).

## Features

- **Dual Search Modes**: Title (keyword) search and semantic search for finding entities
- **Advanced Filtering**: Filter by statuses when needed; callers may provide an immutable entity scope
- **Selection Modes**: Single-select or multi-select with keyboard shortcuts
- **Entity Preview**: View full entity details before selecting, with type-specific rendering
- **Responsive Layout**: Search controls and results adapt to wide and narrow screens
- **Similarity Scores**: Display similarity scores when using semantic search
- **Customizable Thresholds**: Adjust similarity thresholds and enable recent result boosting

## Installation

```typescript
import { AdvancedSearch } from "@hey-hey/ui-common";
import type {
  SearchEntity,
  AdvancedSearchProps,
  SearchFilterState,
} from "@hey-hey/ui-common";
```

## Basic Usage

### Single-Select Mode

```typescript
import { AdvancedSearch } from "@hey-hey/ui-common";
import type { SearchEntity } from "@hey-hey/ui-common";

function MyComponent() {
  const [selectedEntity, setSelectedEntity] = useState<SearchEntity | null>(
    null
  );

  const handleSelect = (entities: SearchEntity[]) => {
    // In single-select mode, entities array will have exactly one item
    setSelectedEntity(entities[0]);
  };

  return (
    <AdvancedSearch
      organizationId="org-123"
      onSelect={handleSelect}
      allowMultiSelect={false}
    />
  );
}
```

### Multi-Select Mode

```typescript
import { AdvancedSearch } from "@hey-hey/ui-common";
import type { SearchEntity } from "@hey-hey/ui-common";

function MyComponent() {
  const [selectedEntities, setSelectedEntities] = useState<SearchEntity[]>([]);

  const handleSelect = (entities: SearchEntity[]) => {
    // In multi-select mode, entities array can have multiple items
    setSelectedEntities(entities);
  };

  const handleClose = () => {
    // Handle closing the search interface
  };

  return (
    <AdvancedSearch
      organizationId="org-123"
      onSelect={handleSelect}
      allowMultiSelect={true}
      onClose={handleClose}
    />
  );
}
```

### With Default Filters

```typescript
<AdvancedSearch
  organizationId="org-123"
  projectId="proj-456"
  onSelect={handleSelect}
  defaultEntityTypes={["task", "initiative"]}
  defaultStatuses={["active", "in_progress"]}
  maxResults={100}
/>
```

## Props API

### AdvancedSearchProps

| Prop                 | Type                                 | Required | Default                                                                             | Description                                                        |
| -------------------- | ------------------------------------ | -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `organizationId`     | `string`                             | Yes      | -                                                                                   | Organization ID for scoping the search                             |
| `onSelect`           | `(entities: SearchEntity[]) => void` | Yes      | -                                                                                   | Callback when entities are selected                                |
| `allowMultiSelect`   | `boolean`                            | No       | `false`                                                                             | Enable multi-selection mode with checkboxes                        |
| `onClose`            | `() => void`                         | No       | -                                                                                   | Callback when the search modal/interface is closed                 |
| `projectId`          | `string`                             | No       | -                                                                                   | Optional project ID to filter results                              |
| `defaultEntityTypes` | `string[]`                           | No       | -                                                                                   | Optional immutable entity scope for callers that need type-restricted results (e.g., `['task', 'initiative']`) |
| `defaultStatuses`    | `string[]`                           | No       | `[]`                                                                                | Default statuses to filter by (e.g., `['active', 'completed']`)    |
| `maxResults`         | `number`                             | No       | `50`                                                                                | Maximum number of results to return                                |

### SearchEntity

| Property      | Type                                 | Description                                            |
| ------------- | ------------------------------------ | ------------------------------------------------------ |
| `id`          | `string`                             | Unique entity identifier                               |
| `type`        | `string`                             | Entity type (e.g., 'task', 'initiative', 'design_doc') |
| `name`        | `string`                             | Entity name/title                                      |
| `description` | `string` (optional)                  | Entity description                                     |
| `status`      | `string` (optional)                  | Entity status                                          |
| `similarity`  | `number` (optional)                  | Similarity score for semantic search (0.0-1.0)         |
| `metadata`    | `Record<string, unknown>` (optional) | Additional entity metadata                             |

### SearchFilterState

| Property       | Type                 | Description                                   |
| -------------- | -------------------- | --------------------------------------------- |
| `entityTypes`  | `string[]` (optional) | Immutable entity scope supplied by the caller |
| `statuses`     | `string[]`           | Status values to filter by                    |
| `initiativeId` | `string` (optional)  | Filter by parent initiative ID                |
| `parentTaskId` | `string` (optional)  | Filter by parent task ID                      |
| `threshold`    | `number` (optional)  | Similarity threshold (0.0-1.0), default: 0.15 |
| `boostRecent`  | `boolean` (optional) | Boost more recent results                     |

## Component Features

### Search Modes

**Title Search**: Keyword-based search that matches entity names/titles

```typescript
// User types in title search input
// Results show entities with matching titles
```

**Semantic Search**: AI-powered search that finds semantically similar entities

```typescript
// User types in semantic search input
// Results show entities with similar meaning, ranked by similarity score
```

### Filtering Options

- **Entity Scope**: Callers may provide an immutable type scope when a consuming surface requires one
- **Status**: Filter by entity status (active, completed, etc.)
- **Parent Initiative**: Show only entities belonging to a specific initiative
- **Parent Task**: Show only entities that are sub-tasks of a specific task
- **Similarity Threshold**: Adjust minimum similarity score for semantic search results
- **Recent Boost**: Prioritize more recently created/updated entities

### Selection Behavior

**Single-Select Mode** (`allowMultiSelect={false}`):

- Click on an entity to select it immediately
- `onSelect` is called with a single-item array
- No selection UI (checkboxes) shown
- Preview mode allows viewing before selection

**Multi-Select Mode** (`allowMultiSelect={true}`):

- Checkboxes appear on each result
- Click checkboxes or result items to add to selection
- Selected count shown at bottom
- "Select N items" button appears when items are selected
- `onSelect` is called when user clicks the select button
- Preview mode adds entities to selection without closing

### Entity Preview

The preview feature allows users to view full entity details before selecting:

```typescript
// Click the preview icon on any result
// Shows full entity information in a dedicated view
// Can select from preview (adds to selection in multi-select mode)
// Return to search results with back button
```

Preview displays:

- Full entity name and description
- Entity type and status
- Additional metadata
- Type-specific rendering for different entity types

### Responsive Layout

The component adapts to screen size:

**Wide Screens** (md and up):

- Search inputs and results in the main area
- Advanced status filter remains inline with the search surface

**Narrow Screens** (below md):

- Search inputs and results use a single-column layout
- Optimized for mobile/tablet

## Modal Integration

To integrate AdvancedSearch with your application via the modal system, see the [Modal System README](../../contexts/ModalSystem.README.md).

**Quick example:**

```typescript
import { useModalService } from "@hey-hey/ui-common/context";
import type { SearchEntity } from "@hey-hey/ui-common";

function MyComponent() {
  const modalService = useModalService();

  const handleOpenSearch = () => {
    if (!modalService) return;

    modalService.showAdvancedSearch({
      defaultEntityTypes: ["task", "initiative"],
      allowMultiSelect: true,
      onSelect: (entities: SearchEntity[]) => {
        // Handle selected entities
        console.log("Selected:", entities);
      },
    });
  };

  return <button onClick={handleOpenSearch}>Open Search</button>;
}
```

## Type Exports

The component exports the following TypeScript types:

```typescript
// Main component props
export type { AdvancedSearchProps } from "./types";

// Search entity interface
export type { SearchEntity } from "./types";

// Filter state interface
export type { SearchFilterState } from "./types";
```

## Styling and Theming

The component uses MUI's theming system and is fully responsive:

- Respects theme colors and spacing
- Uses theme breakpoints for responsive layout
- Supports dark/light mode through theme
- Custom styling via MUI's `sx` prop can be applied to the Dialog wrapper

## Error Handling

The component handles errors gracefully:

- Network errors are displayed with clear error messages
- Loading states show progress indicators
- Empty results show "No matches found" message
- Invalid filters are validated before search

## Performance Considerations

- Search is debounced to avoid excessive API calls
- Results are paginated with configurable `maxResults`
- Entity preview loads data lazily
- Virtual scrolling for large result sets (handled by SearchResults)

## Accessibility

- Keyboard navigation supported throughout
- ARIA labels on interactive elements
- Focus management for modal/dialog usage
- Screen reader friendly with descriptive labels
- Proper semantic HTML structure

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Responsive design works on mobile/tablet
- No IE11 support (uses modern JavaScript features)
