# Shared Tab Components

This directory contains reusable tab components used across all detail pages.

## Components

### TabContainer

Provides consistent styling wrapper for all tab content.

**Features:**
- Consistent background color: `rgb(249, 249, 251)`
- Standard padding: `24px`
- Full width layout
- Paper component with rounded corners

**Usage:**
```typescript
import { TabContainer } from './TabContainer';

<TabContainer>
  <YourTabContent />
</TabContainer>
```

### TaskTab

Displays tasks with filters, sorting, and task generation.

**Props:**
- `projectId` (required): Project ID
- `initiativeId` (required): Initiative ID
- `initiativeName` (required): Initiative name for display
- `organizationId` (optional): Organization ID
- `tasks` (optional): Task data array
- `loading` (optional): Loading state
- `expandable` (optional): Enable task expansion
- `enableFilters` (optional): Show search/sort filters
- `onNewTask` (required): Handler for creating new tasks

**Features:**
- Search filtering by task name
- Status filtering
- Sort by various criteria
- Task generation assistant
- Empty state handling

**Usage:**
```typescript
<TaskTab
  projectId={projectId}
  initiativeId={initiativeId}
  initiativeName="My Initiative"
  organizationId={orgId}
  enableFilters={true}
  onNewTask={handleNewTask}
/>
```

### DesignDocsTab

Displays design documents with filters and sorting.
Supports queries by task, initiative, or design doc (doc-to-doc links).

**Props:**
- `organizationId` (required): Organization ID
- `projectId` (required): Project ID
- `taskId` (optional): Filter by task ID
- `initiativeId` (optional): Filter by initiative ID
- `designDocId` (optional): Filter by design doc ID (doc-to-doc queries)
- `emptyMessage` (optional): Custom empty state message
- `enableFilters` (optional): Show search/sort filters (default: false)

**Query Types:**
- `by-task`: Shows design docs linked to a specific task
- `by-initiative`: Shows design docs linked to an initiative
- `doc-to-doc`: Shows design docs linked to another design doc

**Query Priority:** taskId → initiativeId → designDocId

**Features:**
- Search filtering by document title
- Sort by creation date or name
- Empty state handling
- Loading state
- Consistent styling via TabContainer

**Usage:**
```typescript
// Filter by task
<DesignDocsTab
  organizationId={orgId}
  projectId={projectId}
  taskId={taskId}
  enableFilters={true}
  emptyMessage="No design documents linked to this task"
/>

// Filter by initiative
<DesignDocsTab
  organizationId={orgId}
  projectId={projectId}
  initiativeId={initiativeId}
  enableFilters={true}
  emptyMessage="No design documents linked to this initiative yet."
/>

// Doc-to-doc links
<DesignDocsTab
  organizationId={orgId}
  projectId={projectId}
  designDocId={documentId}
  enableFilters={true}
  emptyMessage="No linked documents found."
/>
```

### AgentSessionsTab

Displays agent sessions with filters and sorting.
Supports queries by task, initiative, design doc, conversation, or user.

**Props:**
- `organizationId` (required): Organization ID
- `projectId` (required): Project ID
- `taskId` (optional): Filter by task ID
- `initiativeId` (optional): Filter by initiative ID
- `designDocId` (optional): Filter by design doc ID
- `conversationId` (optional): Filter by conversation ID
- `userId` (optional): Filter by user ID
- `loading` (optional): External loading state
- `emptyMessage` (optional): Custom empty state message
- `enableFilters` (optional): Show search/sort filters (default: false)

**Features:**
- Search filtering by session title
- Sort by creation date or name
- Empty state handling
- Loading state
- Delete functionality
- Session click navigation
- Consistent styling via TabContainer

**Usage:**
```typescript
// Filter by task
<AgentSessionsTab
  organizationId={orgId}
  projectId={projectId}
  taskId={taskId}
  initiativeId={initiativeId}
  loading={!orgId}
  enableFilters={true}
  emptyMessage="No agent sessions found for this task yet."
/>

// Filter by design doc
<AgentSessionsTab
  organizationId={orgId}
  projectId={projectId}
  designDocId={documentId}
  enableFilters={true}
  emptyMessage="No agent sessions linked to this design document yet."
/>
```

### ImplementationHintsTab

Displays implementation hints with filters and sorting.
Supports queries by service, agent session, or coding prompt.

**Props:**
- `organizationId` (required): Organization ID
- `serviceId` (optional): Service ID
- `agentSessionId` (optional): Filter by agent session ID
- `codingPromptId` (optional): Filter by coding prompt ID
- `emptyMessage` (optional): Custom empty state message
- `enableFilters` (optional): Show search/sort filters (default: false)
- `enabled` (optional): Enable data loading (default: true)

**Features:**
- Search filtering by feature name or description
- Sort by creation date or name
- Empty state handling
- Optional inline editing via ImplementationHintEditor
- Consistent styling via TabContainer

**Usage:**
```typescript
// Filter by service
<ImplementationHintsTab
  organizationId={orgId}
  serviceId={serviceId}
  enableFilters={true}
/>

// Filter by agent session
<ImplementationHintsTab
  organizationId={orgId}
  projectId={projectId}
  agentSessionId={agentSessionId}
  enableFilters={true}
/>
```

### ConversationTab

Displays conversations with history and active conversation view.

**Props:**
- `organizationId` (required): Organization ID
- `projectId` (required): Project ID
- `workflowAboutId` (optional): Related entity ID
- `workflowAboutType` (optional): Entity type (e.g., "design-doc")

**Features:**
- Conversation history list
- Active conversation display
- Context-aware queries
- Empty state handling

**Usage:**
```typescript
<ConversationTab
  organizationId={orgId}
  projectId={projectId}
  workflowAboutId={entityId}
  workflowAboutType="design-doc"
/>
```

## Filter Support

All tabs support optional filtering via `enableFilters` prop:
- **Search**: Filters by name/title in real-time
- **Sort**: created-desc, created-asc, name-asc, name-desc

Filters are managed via URL query parameters for shareable filtered views.

## Pattern Consistency

All tab components follow the same pattern:

1. **TabContainer wrapper**: Consistent styling (Paper component with background color)
2. **EntityFilters integration**: Optional search/sort controls via `enableFilters` prop
3. **Empty state handling**: Customizable empty messages via `emptyMessage` prop
4. **Loading state**: Display loading indicators while data fetches
5. **URL state management**: Filters stored in URL query parameters (using `nuqs`)

## Integration Points

### Pages Using Shared Tab Components

- **InitiativePage**: DesignDocsTab, TaskTab, ConversationTab
- **TaskPage**: DesignDocsTab, AgentSessionsTab, ConversationTab
- **ServicePage**: DesignDocsTab, ImplementationHintsTab, AgentSessionsTab, ConversationTab, TaskTab
- **DocumentPage**: DesignDocsTab (linked docs), AgentSessionsTab, ConversationTab
- **AgentSessionPage**: ImplementationHintsTab, ConversationTab

### Data Layer Integration

All tabs use the `@hey-hey/ui-common` data layer:
- `useDesignDocLinks` hook for design documents
- `useAgentSessions` hook for agent sessions
- `useTasks` hook for tasks
- Collection classes for data operations

## Migration Notes

These components were created during the "Shared Tab Components Migration" (2025-12-28) to:
- Eliminate duplicate tab implementations across pages
- Provide consistent UX across all detail pages
- Centralize filter logic and styling
- Enable better maintainability

All "Coming Soon" placeholders and direct list component usage have been replaced with these shared tab components.

## Development Guidelines

When modifying tab components:
1. Maintain backward compatibility with all existing page integrations
2. Keep consistent styling via TabContainer
3. Test all query type variations (by-task, by-initiative, etc.)
4. Update this documentation when adding new features
5. Run `pnpm run type-check` to verify TypeScript compliance
