# @src/data/ Layer Usage Guide

A comprehensive guide to using the revolutionary data management system with automatic cache invalidation.

## Table of Contents

1. [Introduction & Quick Start](#introduction--quick-start)
2. [Core Concepts](#core-concepts)
3. [Basic Usage Patterns](#basic-usage-patterns)
4. [The QueryKeys Revolution](#the-querykeys-revolution)
5. [Advanced Usage Patterns](#advanced-usage-patterns)
6. [Real-time Integration](#real-time-integration)
7. [Testing & Debugging](#testing--debugging)
8. [Migration & Integration](#migration--integration)

---

## Introduction & Quick Start

The `@src/data/` layer is a sophisticated state management system built on Jotai atoms that revolutionizes how React applications handle data fetching, caching, and real-time updates.

### What is the @src/data/ layer?

This system provides:

- **Automatic cache invalidation** through the revolutionary QueryKeys architecture
- **Real-time synchronization** via WebSocket integration without manual pattern tracking
- **Type-safe data fetching** with comprehensive error handling and loading states
- **Optimistic updates** with automatic rollback capability
- **Performance optimization** through intelligent deduplication and stale time management

### Why it exists

Traditional data management approaches suffer from:

- Manual WebSocket cache invalidation patterns that break as applications evolve
- Complex state management requiring extensive boilerplate
- Difficulty coordinating loading states across multiple components
- Error-prone cache invalidation that leads to stale data

The @src/data/ layer solves these problems with a unified, declarative approach.

### 5-Minute Quick Start

Here's a complete working example that demonstrates the core functionality:

```tsx
import React from "react";
import { useProjects } from "@src/data/hooks/useProjects";
import { LoadingSpinner, ErrorMessage } from "@src/components";

const ProjectList: React.FC<{ organizationId: string }> = ({
  organizationId,
}) => {
  const { projects, isLoading, error, refetch } = useProjects(organizationId);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} retry={refetch} />;

  return (
    <div>
      <h2>Projects</h2>
      {projects?.map((project) => (
        <div key={project.id} className="project-card">
          <h3>{project.name}</h3>
          <p>{project.description}</p>
          <small>
            Updated: {new Date(project.updatedAt).toLocaleDateString()}
          </small>
        </div>
      ))}
    </div>
  );
};
```

This example demonstrates:

- **Declarative data fetching**: Just call `useProjects()` and get your data
- **Automatic loading states**: Built-in `isLoading` management
- **Error handling**: Comprehensive error state with retry capability
- **Real-time updates**: Data automatically refreshes when changed via WebSocket events

### Error Handling Pattern

```tsx
const ConversationViewer: React.FC = () => {
  const { conversation, isLoading, error, refetch } = useConversation(
    conversationId,
    organizationId,
    projectId
  );

  if (isLoading) return <LoadingSpinner />;

  if (error) {
    return (
      <div className="error-state">
        <p>Failed to load conversation: {error.message}</p>
        <button onClick={() => refetch()}>Try Again</button>
      </div>
    );
  }

  if (!conversation) {
    return <div>Conversation not found</div>;
  }

  return (
    <div>
      <h2>{conversation.title}</h2>
      <div>{conversation.content}</div>
    </div>
  );
};
```

### Complete Component Integration

```tsx
const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { projects, isLoading: projectsLoading } = useProjects(
    user.organizationId
  );
  const { initiatives, isLoading: initiativesLoading } = useInitiatives(
    user.organizationId,
    null, // All initiatives across projects
    { enabled: !!user.organizationId }
  );

  const isLoading = projectsLoading || initiativesLoading;

  if (isLoading) return <LoadingState />;

  return (
    <div className="dashboard">
      <section>
        <h2>Recent Projects</h2>
        {projects?.slice(0, 5).map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </section>

      <section>
        <h2>Active Initiatives</h2>
        {initiatives
          ?.filter((i) => i.status === "ACTIVE")
          .map((initiative) => (
            <InitiativeCard key={initiative.id} initiative={initiative} />
          ))}
      </section>
    </div>
  );
};
```

### Key Innovations Preview

This system introduces several breakthrough innovations:

1. **QueryKeys Architecture**: Items automatically track which queries loaded them, enabling zero-maintenance cache invalidation
2. **Automatic WebSocket Invalidation**: No more manual pattern tracking - the system handles it automatically
3. **Collection-Based Organization**: Data entities are organized into collections with consistent patterns
4. **Declarative Real-time**: Components automatically subscribe to real-time updates for displayed data

In the next sections, we'll explore these concepts in detail and show you how to leverage the full power of this system.

### Bootstrapping relationship rules

The cross-collection invalidation engine in `src/data/relationships` is data-driven: it consults a validated `InvalidationConfig` (the generated relationship-rule artifact) to decide which collections to mark stale when an entity changes. **That config must be loaded once, at boot, before any data hook or invalidator runs.** Hooks that reach `getRelatedEntities` before initialization throw `Invalidation config has not been loaded. Call loadConfig() first.` — fail-fast by design.

Two integration paths are supported:

1. **React consumers — pass `relationshipRules` to `DataHooksProvider`.** The provider initializes the config synchronously, inside the same render that mounts its children, so every descendant sees a loaded config on first read. Wrap your tree once at the app root:

   ```tsx
   import { DataHooksProvider } from "@hey-hey/ui-common";
   import relationshipRules from "./generated/invalidation-config.generated.json";

   export const AppRoot = () => (
     <DataHooksProvider relationshipRules={relationshipRules}>
       <App />
     </DataHooksProvider>
   );
   ```

2. **Non-React consumers (CLI bootstraps, scripts) — call `initRelationshipConfig` directly.** Invoke it before importing or running any code that touches the data layer:

   ```ts
   import { initRelationshipConfig } from "@hey-hey/ui-common";
   import relationshipRules from "./generated/invalidation-config.generated.json";

   initRelationshipConfig(relationshipRules);
   // ...now safe to use invalidator/hook code paths
   ```

**Required boot ordering.** Initialization must complete before mounting any provider that depends on these hooks, or before invoking any data-layer entry point in a non-React context. `initRelationshipConfig` is idempotent — calling it twice with the same payload is a no-op — but a second call with a _different_ payload throws so misconfigured boots fail loudly instead of silently swapping rules under live consumers. Use `resetConfig()` (test-only) to reinitialize.

**Expected payload shape.** The argument is a validated `InvalidationConfig`:

```ts
interface InvalidationConfig {
  version: string;
  generatedAt: string;
  rules: InvalidationRule[];
}
```

`validateConfig` rejects unknown keys, empty strings, and malformed enums; the loader throws synchronously when the payload does not conform.

**Generated artifact resolution is the consumer's responsibility.** This package does not import the generated rules JSON itself — that keeps bundling, code-splitting, and artifact-path resolution in the application's control. Resolve the artifact (build-time import, runtime fetch, or whatever your bundler prefers), then hand the parsed object to the provider or `initRelationshipConfig`. See the relationship-config design doc for the rule semantics this contract is built on.

---

## Core Concepts

Understanding these foundational concepts will help you effectively use the @src/data/ layer system.

### Collections

Collections are the primary organizational unit for related data entities. Each collection manages state for a specific type of data (projects, conversations, initiatives) and provides consistent patterns for data access.

```typescript
// Collection anatomy example
export const conversationCollection = createCollection<ConversationResponseDto>(
  {
    name: "conversations",
    fetcher: async (queryKey: string) => {
      const [entity, orgId, projectId, category, search] =
        parseConversationQueryKey(queryKey);

      if (entity === "conversation") {
        const data = await conversationsApi.getConversation(
          orgId,
          projectId,
          entity
        );
        return { isArray: false, data };
      } else {
        const filters = { category, search };
        const data = await conversationsApi.getConversations(
          orgId,
          projectId,
          filters
        );
        return { isArray: true, data };
      }
    },
    staleTimeMs: 30000, // Data considered fresh for 30 seconds
    // Deduplicate requests within 1 second
  }
);
```

Collections provide:

- **State management**: Centralized state using Jotai atoms
- **Query coordination**: Manages multiple queries for the same entity type
- **Cache management**: Automatic stale detection and invalidation
- **Loading states**: Coordinated loading state management
- **Error handling**: Centralized error state management

### Hook Types

The system provides three main types of hooks, each optimized for different use cases:

```typescript
// 1. Data Access Hooks - Read data with automatic fetching
const { projects } = useProjects(organizationId); // List of projects
const { project } = useProject(projectId, organizationId); // Single project
const { conversations } = useConversations(orgId, projectId, {
  category: "onboarding",
  search: searchTerm,
  enabled: !!user,
});

// 2. Mutation Hooks - Create, update, delete operations
const { create: createProject } = useCreateProject();
const { update: updateProject } = useUpdateProject();
const { remove: deleteProject } = useDeleteProject();

// 3. Utility Hooks - Special purpose functionality
const { markStale } = useMarkStale();
const { refetch } = useRefetch();
```

Each hook type serves specific purposes:

- **Data Access Hooks**: Declarative data fetching with caching and real-time updates
- **Mutation Hooks**: Safe data modification with optimistic updates and error handling
- **Utility Hooks**: Advanced cache management and debugging capabilities

### QueryKeys Introduction

QueryKeys are hierarchical strings that uniquely identify data queries. They follow a consistent pattern:

```typescript
// Query key patterns and their meaning
"projects:org123"; // All projects for organization
"project:org123:proj456"; // Single project
"conversations:org123:proj456::"; // All conversations for project
"conversations:org123:proj456:onboarding:"; // Filtered conversations
"conversation:org123:proj456:conv789"; // Single conversation
"initiatives:org123:proj456:ACTIVE"; // Active initiatives for project
```

Key characteristics:

- **Hierarchical**: Organized from general to specific
- **Predictable**: Follow consistent naming conventions
- **Filterable**: Support query parameters and filters
- **Cacheable**: Enable efficient cache management

The revolutionary aspect (covered in detail in section 4) is that items automatically track which queries loaded them, enabling automatic cache invalidation.

### State Management with Jotai

The system uses Jotai atoms for fine-grained reactive state management:

```typescript
// Each collection has dedicated atoms
const conversationStateAtom =
  atom<CollectionState<ConversationResponseDto>>(initialState);
const conversationActionsAtom = atom(null, async (get, set, action) => {
  // Handle synchronous and asynchronous actions
});

// Components automatically re-render when relevant state changes
const ConversationList: React.FC = () => {
  const { conversations, isLoading } = useConversations(orgId, projectId);
  // Component re-renders when conversations data or loading state changes
  return <div>{/* render conversations */}</div>;
};
```

Benefits of this approach:

- **Fine-grained reactivity**: Components only re-render when their data changes
- **Automatic subscriptions**: No manual subscription management required
- **Performance optimization**: Minimal re-renders across the application
- **Type safety**: Full TypeScript support throughout the state layer

### Query Patterns and Conventions

The system follows consistent patterns for query organization:

```typescript
// Naming conventions
{entityType}:{organizationId}:{projectId}:{filters}

// Examples with explanations
"projects:org123"                    // Base pattern: all projects
"projects:org123:ACTIVE"             // With filter: active projects only
"project:org123:proj456"             // Single item: specific project
"conversations:org123:proj456::"     // Nested entity: all conversations
"conversations:org123:proj456:chat:" // Nested with filter: chat conversations
```

Pattern benefits:

- **Consistency**: All queries follow the same structure
- **Predictability**: Easy to construct and parse query keys
- **Hierarchical caching**: Related queries can be invalidated together
- **Filter support**: Natural support for query parameters and filters

### Integration with React Components

The hooks integrate seamlessly with React's component lifecycle:

```typescript
const ProjectDashboard: React.FC<{ projectId: string }> = ({ projectId }) => {
  // Hooks automatically handle:
  // - Initial data fetching
  // - Loading state management
  // - Error state handling
  // - Real-time updates
  // - Cache management

  const { project, isLoading, error } = useProject(projectId, organizationId);
  const { initiatives } = useInitiatives(organizationId, projectId);
  const { conversations } = useConversations(organizationId, projectId);

  // Components are reactive to data changes
  // No manual subscriptions or state management needed

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorDisplay error={error} />;

  return (
    <div>
      <ProjectHeader project={project} />
      <InitiativesList initiatives={initiatives} />
      <ConversationPanel conversations={conversations} />
    </div>
  );
};
```

This declarative approach eliminates common patterns like:

- Manual loading state coordination
- Complex useEffect dependency arrays
- Manual subscription management
- Error boundary boilerplate

The system handles these concerns automatically, letting you focus on your application logic.

---

## Basic Usage Patterns

This section covers the most common scenarios you'll encounter when using the @src/data/ layer, representing about 80% of daily usage.

### Data Fetching with Loading States

The most common pattern is fetching lists and individual items with proper loading state management:

```typescript
// List fetching with automatic loading states
const ConversationList: React.FC<{
  organizationId: string;
  projectId: string;
}> = ({ organizationId, projectId }) => {
  const { conversations, isLoading, error, refetch } = useConversations(
    organizationId,
    projectId
  );

  if (isLoading) {
    return (
      <div className="loading-container">
        <LoadingSpinner />
        <p>Loading conversations...</p>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        message="Failed to load conversations"
        error={error}
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="conversation-list">
      {conversations?.map((conversation) => (
        <ConversationCard
          key={conversation.id}
          conversation={conversation}
          onClick={() => navigate(`/conversations/${conversation.id}`)}
        />
      ))}
    </div>
  );
};
```

### Error Handling Patterns

Comprehensive error handling with user-friendly recovery options:

```typescript
const ProjectDetails: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { project, isLoading, error, refetch, markStale } = useProject(
    projectId,
    organizationId
  );

  // Handle different error types
  const renderError = () => {
    if (error?.message?.includes("Not found")) {
      return (
        <div className="error-not-found">
          <h3>Project Not Found</h3>
          <p>
            The project you're looking for doesn't exist or you don't have
            access to it.
          </p>
          <button onClick={() => navigate("/projects")}>
            Back to Projects
          </button>
        </div>
      );
    }

    if (error?.message?.includes("Network")) {
      return (
        <div className="error-network">
          <h3>Connection Problem</h3>
          <p>Unable to load project data. Check your internet connection.</p>
          <div className="error-actions">
            <button onClick={refetch}>Try Again</button>
            <button onClick={markStale}>Force Refresh</button>
          </div>
        </div>
      );
    }

    return (
      <div className="error-generic">
        <h3>Something went wrong</h3>
        <p>{error?.message || "Unknown error occurred"}</p>
        <button onClick={refetch}>Retry</button>
      </div>
    );
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return renderError();
  if (!project) return <div>Project not found</div>;

  return <ProjectContent project={project} />;
};
```

### Filtering and Search

Dynamic filtering with query parameters and real-time search:

```typescript
const ConversationSearch: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [debouncedSearch] = useDebounce(searchTerm, 300);

  const { conversations, isLoading } = useConversations(
    organizationId,
    projectId,
    {
      category: selectedCategory,
      search: debouncedSearch,
      enabled: true, // Always enabled
      refetchOnWindowFocus: true, // Refresh when window gains focus
    }
  );

  return (
    <div className="conversation-search">
      <div className="search-controls">
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <select
          value={selectedCategory || ""}
          onChange={(e) => setSelectedCategory(e.target.value || null)}
        >
          <option value="">All Categories</option>
          <option value="onboarding">Onboarding</option>
          <option value="support">Support</option>
          <option value="feedback">Feedback</option>
        </select>
      </div>

      <div className="search-results">
        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <>
            <p>{conversations?.length || 0} conversations found</p>
            {conversations?.map((conversation) => (
              <ConversationCard
                key={conversation.id}
                conversation={conversation}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
};
```

### CRUD Operations with Optimistic Updates

Create, update, and delete operations with immediate UI feedback:

```typescript
const ProjectManager: React.FC = () => {
  const { projects, isLoading } = useProjects(organizationId);
  const { create: createProject } = useCreateProject();
  const { update: updateProject } = useUpdateProject();
  const { remove: deleteProject } = useDeleteProject();

  const handleCreateProject = async (projectData: CreateProjectData) => {
    try {
      const newProject = await createProject({
        ...projectData,
        organizationId,
      });

      // UI automatically updates due to collection state management
      toast.success("Project created successfully");
      navigate(`/projects/${newProject.id}`);
    } catch (error) {
      toast.error(`Failed to create project: ${error.message}`);
    }
  };

  const handleUpdateProject = async (
    projectId: string,
    updates: Partial<Project>
  ) => {
    try {
      // Optimistic update - UI updates immediately
      await updateProject(projectId, updates);
      toast.success("Project updated");
    } catch (error) {
      // Automatic rollback on error
      toast.error(`Failed to update project: ${error.message}`);
    }
  };

  const handleDeleteProject = async (
    projectId: string,
    projectName: string
  ) => {
    if (!confirm(`Delete "${projectName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteProject(projectId);
      toast.success("Project deleted");
    } catch (error) {
      toast.error(`Failed to delete project: ${error.message}`);
    }
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="project-manager">
      <div className="project-header">
        <h2>Projects</h2>
        <CreateProjectButton onCreate={handleCreateProject} />
      </div>

      <div className="project-grid">
        {projects?.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onUpdate={(updates) => handleUpdateProject(project.id, updates)}
            onDelete={() => handleDeleteProject(project.id, project.name)}
          />
        ))}
      </div>
    </div>
  );
};
```

### Managing Multiple Loading States

Coordinate loading states across multiple data sources:

```typescript
const Dashboard: React.FC = () => {
  const {
    projects,
    isLoading: projectsLoading,
    error: projectsError,
  } = useProjects(organizationId);
  const {
    initiatives,
    isLoading: initiativesLoading,
    error: initiativesError,
  } = useInitiatives(
    organizationId,
    null, // All projects
    { enabled: !!organizationId }
  );
  const { conversations, isLoading: conversationsLoading } = useConversations(
    organizationId,
    null, // All projects
    { enabled: !!organizationId && projects !== null }
  );

  // Determine overall loading state
  const isInitialLoading = projectsLoading || initiativesLoading;
  const isPartialLoading = conversationsLoading;
  const hasErrors = projectsError || initiativesError;

  // Show initial loading screen
  if (isInitialLoading) {
    return (
      <div className="dashboard-loading">
        <LoadingSpinner size="large" />
        <p>Loading dashboard data...</p>
      </div>
    );
  }

  // Show error state for critical data
  if (hasErrors) {
    return (
      <ErrorState
        message="Failed to load dashboard"
        error={projectsError || initiativesError}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="dashboard">
      <DashboardHeader />

      <div className="dashboard-grid">
        <ProjectOverview projects={projects} />
        <InitiativesSummary initiatives={initiatives} />

        <ConversationsPanel
          conversations={conversations}
          isLoading={isPartialLoading}
        />
      </div>
    </div>
  );
};
```

### Cache Management and Refresh Patterns

Understanding when and how to refresh data:

```typescript
const DataManagementExample: React.FC = () => {
  const { conversations, isLoading, isStale, refetch, markStale } =
    useConversations(organizationId, projectId);

  // Manual refresh button
  const handleRefresh = async () => {
    try {
      await refetch();
      toast.success("Data refreshed");
    } catch (error) {
      toast.error("Failed to refresh data");
    }
  };

  // Force refresh (bypasses cache)
  const handleForceRefresh = () => {
    markStale(); // Mark data as stale
    // Data will automatically refetch due to stale state
  };

  // Check data freshness
  const getDataStatus = () => {
    if (isLoading) return "loading";
    if (isStale) return "stale";
    return "fresh";
  };

  return (
    <div className="data-management">
      <div className="data-controls">
        <div className="data-status">
          Status:{" "}
          <span className={`status-${getDataStatus()}`}>{getDataStatus()}</span>
        </div>

        <div className="refresh-controls">
          <button onClick={handleRefresh} disabled={isLoading}>
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>

          <button onClick={handleForceRefresh}>Force Refresh</button>
        </div>
      </div>

      <ConversationList conversations={conversations} />
    </div>
  );
};
```

### Conditional Data Fetching

Control when data fetching occurs based on component state:

```typescript
const ConditionalFetchExample: React.FC = () => {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );
  const { user } = useAuth();

  // Only fetch projects when user is authenticated
  const { projects } = useProjects(user?.organizationId, {
    enabled: !!user?.organizationId,
  });

  // Only fetch conversations when a project is selected
  const { conversations, isLoading: conversationsLoading } = useConversations(
    user?.organizationId,
    selectedProjectId,
    {
      enabled: !!user?.organizationId && !!selectedProjectId,
      refetchOnWindowFocus: false, // Disable automatic refetch
    }
  );

  // Only fetch initiatives for premium users
  const { initiatives } = useInitiatives(
    user?.organizationId,
    selectedProjectId,
    {
      enabled: !!user?.organizationId && !!selectedProjectId && user?.isPremium,
    }
  );

  return (
    <div className="conditional-fetch">
      <ProjectSelector
        projects={projects}
        selectedId={selectedProjectId}
        onSelect={setSelectedProjectId}
      />

      {selectedProjectId && (
        <div className="project-details">
          <ConversationsSection
            conversations={conversations}
            isLoading={conversationsLoading}
          />

          {user?.isPremium && <InitiativesSection initiatives={initiatives} />}
        </div>
      )}
    </div>
  );
};
```

### Working with Related Data

Handle relationships between different entity types:

```typescript
const RelatedDataExample: React.FC<{ conversationId: string }> = ({
  conversationId,
}) => {
  // Get the main conversation
  const { conversation, isLoading } = useConversation(
    conversationId,
    organizationId,
    projectId
  );

  // Get related data based on the conversation
  const { project } = useProject(conversation?.projectId, organizationId, {
    enabled: !!conversation?.projectId,
  });

  const { initiatives } = useInitiatives(
    organizationId,
    conversation?.projectId,
    { enabled: !!conversation?.projectId }
  );

  // Get artifacts related to this conversation
  const { artifacts } = useArtifacts({
    organizationId,
    projectId: conversation?.projectId,
    sourceId: conversationId,
    enabled: !!conversation,
  });

  if (isLoading) return <LoadingSpinner />;
  if (!conversation) return <div>Conversation not found</div>;

  return (
    <div className="conversation-details">
      <ConversationHeader conversation={conversation} project={project} />

      <div className="conversation-content">
        <ConversationMessages conversation={conversation} />

        <div className="related-data">
          <RelatedInitiatives initiatives={initiatives} />
          <RelatedArtifacts artifacts={artifacts} />
        </div>
      </div>
    </div>
  );
};
```

These patterns cover the vast majority of scenarios you'll encounter. The key principles are:

- **Declarative data access**: Use hooks to describe what data you need
- **Automatic state management**: Let the system handle loading, errors, and caching
- **Conditional fetching**: Use the `enabled` option to control when data loads
- **Optimistic updates**: Provide immediate feedback for better user experience
- **Error recovery**: Always provide users with clear recovery options

---

## The QueryKeys Revolution

This section explains the breakthrough innovation that makes this data layer system truly revolutionary: automatic cache invalidation through QueryKeys accumulation.

### The Problem with Traditional Approaches

Traditional WebSocket-based cache invalidation requires manually tracking every possible query pattern that might contain updated data. This approach is fragile and breaks as applications evolve:

```typescript
// BEFORE: Manual WebSocket invalidation (brittle and error-prone)
class TraditionalWebSocketHandler {
  private handleConversationUpdated(event: ConversationUpdatedEvent) {
    // Developer must guess EVERY possible query pattern
    this.invalidateQuery(
      `conversations:${event.organizationId}:${event.projectId}::`
    );
    this.invalidateQuery(
      `conversations:${event.organizationId}:${event.projectId}:onboarding:`
    );
    this.invalidateQuery(
      `conversations:${event.organizationId}:${event.projectId}:support:`
    );
    this.invalidateQuery(
      `conversations:${event.organizationId}:${event.projectId}:feedback:`
    );
    this.invalidateQuery(
      `conversation:${event.organizationId}:${event.projectId}:${event.conversationId}`
    );

    // 🚨 PROBLEMS:
    // - Easy to miss query patterns as UI evolves
    // - New filtering options require updating WebSocket handlers
    // - Search queries, pagination, and custom filters often forgotten
    // - Leads to stale data in UI when patterns are missed
    // - Maintenance nightmare as application grows
  }
}
```

Problems with this approach:

- **Fragile**: New query patterns require updating WebSocket handlers
- **Error-prone**: Easy to miss query patterns, leading to stale data
- **High maintenance**: Every UI change might require WebSocket updates
- **Not scalable**: Complexity grows exponentially with application features

### The QueryKeys Revolution: Automatic Invalidation

The @src/data/ system solves this with a revolutionary approach: **items automatically track which queries loaded them**.

```typescript
// AFTER: Automatic QueryKeys invalidation (robust and self-maintaining)
class RevolutionaryWebSocketHandler {
  private handleConversationUpdated(event: ConversationUpdatedEvent) {
    // ONE simple action - system handles everything automatically!
    this.dispatchConversation({
      type: "MARK_ITEM_STALE",
      itemId: event.conversationId,
    });

    // ✨ MAGIC: Automatically invalidates ALL queries that ever loaded this item!
    // No need to know or track query patterns
    // Works with current patterns AND future patterns
    // Zero maintenance required
  }
}
```

### How QueryKeys Work: The Technical Innovation

Each data item maintains an array of queryKeys representing every query that has loaded it:

```typescript
interface CollectionItem<T> {
  id: string;
  data: T;
  queryKeys: string[]; // 🚀 REVOLUTIONARY: Auto-invalidation tracking
  lastFetched: string;
  updatedAt: string;
  fetchedCount: number;
}
```

### Real User Journey: QueryKeys Accumulation

Let's trace how a conversation item accumulates queryKeys as a user navigates the application:

```typescript
// 1. User visits onboarding dashboard
// Query: "conversations:org123:proj456:onboarding:"
// Conversation item after load:
{
  id: "conv789",
  data: { /* conversation data */ },
  queryKeys: ["conversations:org123:proj456:onboarding:"]
}

// 2. User visits project overview (shows all conversations)
// Query: "conversations:org123:proj456::"
// Same conversation item now has:
{
  id: "conv789",
  data: { /* conversation data */ },
  queryKeys: [
    "conversations:org123:proj456:onboarding:",
    "conversations:org123:proj456::"
  ]
}

// 3. User uses search feature
// Query: "conversations:org123:proj456:search:help"
// Same conversation appears in search results:
{
  id: "conv789",
  data: { /* conversation data */ },
  queryKeys: [
    "conversations:org123:proj456:onboarding:",
    "conversations:org123:proj456::",
    "conversations:org123:proj456:search:help"
  ]
}

// 4. WebSocket update arrives for conv789
// System automatically invalidates ALL three queries!
// User sees updated data everywhere the conversation appears
```

### Before vs After: The Dramatic Difference

Here's a side-by-side comparison showing the revolutionary improvement:

```typescript
// ❌ BEFORE: Manual Pattern Tracking (Fragile)
class ManualInvalidation {
  handleConversationUpdated(event) {
    // Must manually list every possible query pattern
    const patterns = [
      `conversations:${orgId}:${projectId}::`,
      `conversations:${orgId}:${projectId}:onboarding:`,
      `conversations:${orgId}:${projectId}:support:`,
      `conversations:${orgId}:${projectId}:feedback:`,
      `conversation:${orgId}:${projectId}:${conversationId}`,
      // Did we miss any? Probably...
    ];

    patterns.forEach((pattern) => this.markStale(pattern));

    // 🚨 Problems:
    // - New filtering UI = Update WebSocket handler
    // - Search functionality = More patterns to track
    // - Pagination = Even more complexity
    // - Easy to forget patterns = Stale data in UI
  }
}

// ✅ AFTER: Automatic QueryKeys (Robust)
class AutomaticInvalidation {
  handleConversationUpdated(event) {
    // One line does it all - forever!
    this.dispatch({
      type: "MARK_ITEM_STALE",
      itemId: event.conversationId,
    });

    // ✨ Benefits:
    // - Works with ALL current query patterns
    // - Works with FUTURE query patterns
    // - Zero maintenance required
    // - Impossible to miss patterns
    // - Self-healing as UI evolves
  }
}
```

### The QueryKeys Mechanism in Action

Here's how the system automatically maintains queryKeys:

```typescript
// When a query loads data, items automatically track the query
const fetchConversations = async (queryKey: string) => {
  const conversations = await api.getConversations(/* params */);

  // Each conversation automatically gets the queryKey
  const wrappedConversations = conversations.map((conv) => ({
    ...conv,
    queryKeys: [queryKey], // Initially just this query
    lastFetched: new Date().toISOString(),
  }));

  dispatch({
    type: "SET_ITEMS",
    items: wrappedConversations,
    queryKey,
  });
};

// When the same item loads from different queries, queryKeys accumulate
const mergeItemWithFreshData = (existingItem, freshItem, queryKey) => ({
  ...freshItem,
  queryKeys: [...(existingItem.queryKeys || []), queryKey].filter(
    (key, index, arr) => arr.indexOf(key) === index
  ), // Remove duplicates
});

// When WebSocket events arrive, invalidate ALL tracked queries
const handleItemStale = (itemId: string) => {
  const item = state.items.get(itemId);
  if (item?.queryKeys) {
    // Automatically invalidate every query that loaded this item
    item.queryKeys.forEach((queryKey) => {
      dispatch({ type: "MARK_STALE", queryKey });
    });
  }
};
```

### Benefits of the QueryKeys Revolution

This innovation provides transformative benefits:

#### 1. Zero Maintenance

```typescript
// Add new filtering UI - WebSocket handlers require NO changes
const ConversationFilter: React.FC = () => {
  const [priority, setPriority] = useState<string>();
  const [assignee, setAssignee] = useState<string>();

  // New query pattern automatically tracked
  const { conversations } = useConversations(orgId, projectId, {
    priority,
    assignee,
    // QueryKeys system automatically handles WebSocket invalidation
    // No WebSocket handler updates needed!
  });

  return (/* filtering UI */);
};
```

#### 2. Pattern Agnostic

```typescript
// System works with ANY query pattern structure
"conversations:org:proj::"; // Base queries
"conversations:org:proj:category:support"; // Category filters
"conversations:org:proj:search:urgent"; // Search queries
"conversations:org:proj:assignee:user123"; // User filters
"conversations:org:proj:date:2024-01"; // Date ranges
"conversations:org:proj:complex:tag1,tag2"; // Complex filters

// All automatically handled - no WebSocket changes needed
```

#### 3. Self-Healing Evolution

```typescript
// Application evolves - system adapts automatically
const FutureFeature: React.FC = () => {
  // Imagine new features added months later
  const { conversations } = useConversations(orgId, projectId, {
    sentiment: "positive", // New sentiment filter
    aiAnalysis: "high_priority", // New AI-based filtering
    customTags: ["urgent", "vip"], // Custom tagging system
    // WebSocket invalidation works automatically for all of these!
  });
};
```

#### 4. Impossible to Break

```typescript
// Traditional approach: Developer must remember to update WebSocket handlers
// QueryKeys approach: System automatically tracks everything

// Even complex nested queries work automatically:
const ComplexQuery: React.FC = () => {
  const { conversations } = useConversations(orgId, projectId, {
    filters: {
      category: "support",
      priority: "high",
      tags: ["urgent", "customer"],
      assignee: "user123",
      dateRange: { start: "2024-01-01", end: "2024-01-31" },
      customFields: { department: "sales", region: "us-east" },
    },
  });

  // WebSocket events automatically update this view
  // Developer never needs to touch WebSocket code
};
```

### Real-World Impact

The QueryKeys revolution eliminates entire categories of bugs and maintenance overhead:

```typescript
// ELIMINATED: Stale data bugs
// ❌ "Why doesn't this view update when I edit a conversation?"
// ✅ All views automatically update via QueryKeys

// ELIMINATED: WebSocket maintenance
// ❌ "We added a new filter, now we need to update 5 WebSocket handlers"
// ✅ New filters automatically work with existing WebSocket code

// ELIMINATED: Pattern tracking complexity
// ❌ Spreadsheets tracking which queries need which invalidation patterns
// ✅ System automatically tracks all relationships

// ELIMINATED: Integration testing complexity
// ❌ Testing every possible query/WebSocket combination
// ✅ QueryKeys ensure all combinations work automatically
```

### Developer Experience Transformation

```typescript
// Old workflow (fragile):
// 1. Add new query pattern to component
// 2. Update WebSocket handler to invalidate new pattern
// 3. Test all possible combinations
// 4. Fix bugs when patterns are missed
// 5. Repeat for every new feature

// New workflow (robust):
// 1. Add new query pattern to component
// 2. Done!
// WebSocket invalidation works automatically and forever
```

The QueryKeys revolution represents a paradigm shift from manual, error-prone cache management to automatic, bulletproof invalidation that scales effortlessly with application complexity.

This innovation alone makes the @src/data/ layer worth adopting - it eliminates an entire category of bugs while dramatically reducing maintenance overhead.

---

## Advanced Usage Patterns

This section covers sophisticated scenarios and customization options for power users who need to extend the system or handle complex requirements.

### Creating Custom Collections

When you need to add support for new entity types, create custom collections using the `createCollection` factory:

```typescript
// Define your entity type
interface CustomEntity {
  id: string;
  name: string;
  organizationId: string;
  projectId?: string;
  customData: {
    type: string;
    metadata: Record<string, unknown>;
  };
  createdAt: string;
  updatedAt: string;
}

// Create the collection with custom fetcher logic
export const customEntityCollection = createCollection<CustomEntity>({
  name: "customEntities",
  fetcher: async (queryKey: string) => {
    const [entity, orgId, projectId, filters] = parseCustomQueryKey(queryKey);

    if (entity === "customEntity") {
      // Single item query
      const data = await customEntityApi.getEntity(orgId, projectId, entity);
      return { isArray: false, data };
    } else {
      // List query with filters
      const filterParams = parseFilterString(filters);
      const data = await customEntityApi.getEntities(
        orgId,
        projectId,
        filterParams
      );
      return { isArray: true, data };
    }
  },
  staleTimeMs: 120000, // 2 minutes for relatively stable data
});

// Helper to parse custom query keys
const parseCustomQueryKey = (
  queryKey: string
): [string, string, string?, string?] => {
  const parts = queryKey.split(":");
  return [
    parts[0], // entity type
    parts[1], // organizationId
    parts[2] || null, // projectId (optional)
    parts[3] || null, // filters (optional)
  ];
};

// Create corresponding hooks
export const useCustomEntities = (
  organizationId: string,
  projectId?: string,
  options: {
    type?: string;
    metadata?: Record<string, unknown>;
    enabled?: boolean;
  } = {}
) => {
  const queryKey = buildCustomEntityQueryKey({
    entity: "customEntities",
    organizationId,
    projectId,
    filters: options,
  });

  return useQuery({
    queryKey,
    dispatch: customEntityCollection.actionsAtom,
    state: useAtomValue(customEntityCollection.stateAtom),
    enabled: options.enabled,
  });
};
```

### Optimistic Updates with Rollback

Implement immediate UI feedback with automatic rollback on failure:

```typescript
const useOptimisticInitiativeUpdates = () => {
  const { initiatives } = useInitiatives(organizationId, projectId);

  const updateInitiativeOptimistically = async (
    initiativeId: string,
    updates: Partial<Initiative>
  ) => {
    const originalInitiative = initiatives?.find((i) => i.id === initiativeId);
    if (!originalInitiative) return;

    // Create optimistic version
    const optimisticInitiative = {
      ...originalInitiative,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    try {
      // Apply optimistic update immediately
      dispatch(initiativeActionsAtom, {
        type: "OPTIMISTIC_UPDATE",
        id: initiativeId,
        updater: () => optimisticInitiative,
      });

      // Perform real API call
      const updatedInitiative = await initiativesApi.update(
        initiativeId,
        updates
      );

      // Commit optimistic update (replace with real data)
      dispatch(initiativeActionsAtom, {
        type: "SET_ITEM",
        item: {
          ...updatedInitiative,
          queryKeys: originalInitiative.queryKeys, // Preserve QueryKeys
        },
        queryKey: `initiative:${organizationId}:${projectId}:${initiativeId}`,
      });

      // Clean up optimistic state
      dispatch(initiativeActionsAtom, {
        type: "COMMIT_OPTIMISTIC",
        id: initiativeId,
      });

      return updatedInitiative;
    } catch (error) {
      // Rollback optimistic update
      dispatch(initiativeActionsAtom, {
        type: "ROLLBACK_OPTIMISTIC",
        id: initiativeId,
      });

      throw error;
    }
  };

  return { updateInitiativeOptimistically };
};

// Usage in component
const InitiativeCard: React.FC<{ initiative: Initiative }> = ({
  initiative,
}) => {
  const { updateInitiativeOptimistically } = useOptimisticInitiativeUpdates();
  const [isUpdating, setIsUpdating] = useState(false);

  const handleStatusChange = async (newStatus: InitiativeStatus) => {
    setIsUpdating(true);
    try {
      await updateInitiativeOptimistically(initiative.id, {
        status: newStatus,
      });
      toast.success("Status updated");
    } catch (error) {
      toast.error("Failed to update status");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="initiative-card">
      <h3>{initiative.title}</h3>
      <StatusSelector
        value={initiative.status}
        onChange={handleStatusChange}
        disabled={isUpdating}
      />
      {/* UI immediately reflects optimistic changes */}
    </div>
  );
};
```

### Cross-Entity Updates and Relationships

Handle complex relationships between different data types:

```typescript
const useCrossEntityUpdates = () => {
  const updateInitiativeWithSideEffects = async (
    initiativeId: string,
    updates: Partial<Initiative>
  ) => {
    const result = await updateInitiative(initiativeId, updates);

    // Handle cascading updates based on what changed
    if (updates.status) {
      // Status change affects project statistics
      dispatch(projectActionsAtom, {
        type: "MARK_ITEM_STALE",
        itemId: result.projectId,
      });

      // If completed, might affect user achievement metrics
      if (updates.status === "COMPLETED") {
        dispatch(userActionsAtom, {
          type: "MARK_STALE",
          queryKey: `user-achievements:${result.assignedTo}`,
        });
      }
    }

    if (updates.assignedTo) {
      // Assignment change affects multiple user workload views
      const previousAssignee = initiatives?.find(
        (i) => i.id === initiativeId
      )?.assignedTo;

      if (previousAssignee) {
        dispatch(userActionsAtom, {
          type: "MARK_STALE",
          queryKey: `user-workload:${previousAssignee}`,
        });
      }

      dispatch(userActionsAtom, {
        type: "MARK_STALE",
        queryKey: `user-workload:${updates.assignedTo}`,
      });
    }

    if (updates.priority) {
      // Priority change affects dashboard priority filters
      dispatch(initiativeActionsAtom, {
        type: "MARK_STALE",
        queryKey: `initiatives:${organizationId}:${projectId}:priority:high`,
      });
    }

    return result;
  };

  const deleteInitiativeWithCleanup = async (initiativeId: string) => {
    const initiative = initiatives?.find((i) => i.id === initiativeId);
    if (!initiative) return;

    try {
      await deleteInitiative(initiativeId);

      // Clean up related data
      // Remove from all related queries
      dispatch(initiativeActionsAtom, {
        type: "DELETE_ITEM",
        id: initiativeId,
      });

      // Update project statistics
      dispatch(projectActionsAtom, {
        type: "MARK_ITEM_STALE",
        itemId: initiative.projectId,
      });

      // Update assignee workload if was assigned
      if (initiative.assignedTo) {
        dispatch(userActionsAtom, {
          type: "MARK_STALE",
          queryKey: `user-workload:${initiative.assignedTo}`,
        });
      }

      // Clean up related conversations/artifacts
      dispatch(conversationActionsAtom, {
        type: "MARK_STALE",
        queryKey: `conversations:${organizationId}:${initiative.projectId}:initiative:${initiativeId}`,
      });
    } catch (error) {
      throw new Error(`Failed to delete initiative: ${error.message}`);
    }
  };

  return {
    updateInitiativeWithSideEffects,
    deleteInitiativeWithCleanup,
  };
};
```

### Performance Optimization Strategies

Fine-tune performance with advanced configuration options:

```typescript
// High-performance collection for frequently accessed data
export const highPerformanceCollection = createCollection<PerformanceEntity>({
  name: "performanceEntities",
  fetcher: async (queryKey: string) => {
    // Implement request batching for efficiency
    return await batchedFetcher(queryKey);
  },

  // Aggressive caching for stable data
  staleTimeMs: 300000, // 5 minutes
  dedupeTime: 5000, // 5 second deduplication window
});

// Implement request batching
const pendingBatchRequests = new Map<string, Promise<unknown>>();
const batchQueue: Array<{
  queryKey: string;
  resolve: Function;
  reject: Function;
}> = [];

const batchedFetcher = async (
  queryKey: string
): Promise<FetcherResponse<PerformanceEntity>> => {
  return new Promise((resolve, reject) => {
    batchQueue.push({ queryKey, resolve, reject });

    // Process batch after next tick to collect multiple requests
    setTimeout(processBatch, 0);
  });
};

const processBatch = async () => {
  if (batchQueue.length === 0) return;

  const currentBatch = batchQueue.splice(0, 10); // Process up to 10 at once
  const queryKeys = currentBatch.map((item) => item.queryKey);

  try {
    const results = await api.batchFetch(queryKeys);

    currentBatch.forEach((item, index) => {
      item.resolve(results[index]);
    });
  } catch (error) {
    currentBatch.forEach((item) => {
      item.reject(error);
    });
  }
};

// Memory-efficient pattern for large datasets
const usePaginatedData = <T>(
  entityType: string,
  organizationId: string,
  pageSize: number = 50
) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [allData, setAllData] = useState<T[]>([]);

  const { data: pageData, isLoading } = useQuery({
    queryKey: `${entityType}:${organizationId}:page:${currentPage}`,
    // ... other options
  });

  useEffect(() => {
    if (pageData) {
      setAllData((prev) => {
        const startIndex = (currentPage - 1) * pageSize;
        const newData = [...prev];
        pageData.forEach((item, index) => {
          newData[startIndex + index] = item;
        });
        return newData;
      });
    }
  }, [pageData, currentPage, pageSize]);

  const loadNextPage = () => setCurrentPage((prev) => prev + 1);

  return {
    data: allData,
    currentPage,
    isLoading,
    loadNextPage,
    hasMore: pageData?.length === pageSize,
  };
};
```

### Custom Fetcher Functions and API Integration

Integrate with complex APIs or add middleware:

```typescript
// Advanced fetcher with retry logic and caching
const createAdvancedFetcher = <T>(baseApi: ApiClient) => {
  return async (queryKey: string): Promise<FetcherResponse<T>> => {
    const retryConfig = {
      attempts: 3,
      delay: 1000,
      backoff: 2,
    };

    let lastError: Error;

    for (let attempt = 1; attempt <= retryConfig.attempts; attempt++) {
      try {
        const result = await baseApi.fetch<T>(queryKey);

        // Add request timing for monitoring
        console.log(`[PERF] Query ${queryKey} completed in attempt ${attempt}`);

        return result;
      } catch (error) {
        lastError = error as Error;

        if (attempt < retryConfig.attempts) {
          const delay =
            retryConfig.delay * Math.pow(retryConfig.backoff, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
    }

    throw new Error(
      `Failed after ${retryConfig.attempts} attempts: ${lastError.message}`
    );
  };
};

// Middleware pattern for request/response transformation
const withMiddleware = <T>(
  baseFetcher: (queryKey: string) => Promise<FetcherResponse<T>>,
  middleware: Array<
    (queryKey: string, response?: FetcherResponse<T>) => Promise<void>
  >
) => {
  return async (queryKey: string): Promise<FetcherResponse<T>> => {
    // Pre-request middleware
    for (const mw of middleware) {
      await mw(queryKey);
    }

    const response = await baseFetcher(queryKey);

    // Post-request middleware
    for (const mw of middleware) {
      await mw(queryKey, response);
    }

    return response;
  };
};

// Example middleware implementations
const loggingMiddleware = async (
  queryKey: string,
  response?: FetcherResponse<unknown>
) => {
  if (response) {
    console.log(`✅ Fetched ${queryKey}:`, {
      isArray: response.isArray,
      count: response.isArray ? (response.data as unknown[]).length : 1,
    });
  } else {
    console.log(`🔄 Starting fetch for ${queryKey}`);
  }
};

const analyticsMiddleware = async (
  queryKey: string,
  response?: FetcherResponse<unknown>
) => {
  if (response) {
    analytics.track("data_fetched", {
      queryKey,
      isArray: response.isArray,
      itemCount: response.isArray ? (response.data as unknown[]).length : 1,
    });
  }
};

// Usage in collection creation
export const advancedCollection = createCollection<AdvancedEntity>({
  name: "advancedEntities",
  fetcher: withMiddleware(createAdvancedFetcher(api), [
    loggingMiddleware,
    analyticsMiddleware,
  ]),
  staleTimeMs: 60000,
});
```

### Selective Cache Invalidation

Implement fine-grained control over what gets invalidated:

```typescript
const useSelectiveInvalidation = () => {
  // Invalidate specific query patterns
  const invalidateConversationsByCategory = (category: string) => {
    dispatch(conversationActionsAtom, {
      type: "MARK_STALE",
      queryKey: `conversations:${organizationId}:${projectId}:${category}:`,
    });
  };

  // Invalidate all queries containing specific items
  const invalidateQueriesContainingItem = (itemId: string) => {
    const state = store.get(conversationStateAtom);
    const item = state.items.get(itemId);

    if (item?.queryKeys) {
      item.queryKeys.forEach((queryKey) => {
        dispatch(conversationActionsAtom, {
          type: "MARK_STALE",
          queryKey,
        });
      });
    }
  };

  // Batch invalidation for performance
  const batchInvalidate = (
    invalidations: Array<{ type: string; payload: unknown }>
  ) => {
    // Group by collection to minimize re-renders
    const collectionGroups = new Map();

    invalidations.forEach((inv) => {
      const collection = determineCollection(inv.type);
      if (!collectionGroups.has(collection)) {
        collectionGroups.set(collection, []);
      }
      collectionGroups.get(collection).push(inv);
    });

    // Apply invalidations in batches
    collectionGroups.forEach((invs, collection) => {
      dispatch(collection.actionsAtom, {
        type: "BATCH_INVALIDATE",
        invalidations: invs,
      });
    });
  };

  // Smart invalidation based on user context
  const invalidateUserSpecificData = (userId: string) => {
    // Only invalidate data that this user can see
    dispatch(conversationActionsAtom, {
      type: "MARK_STALE",
      queryKey: `conversations:${organizationId}:${projectId}:assignee:${userId}`,
    });

    dispatch(initiativeActionsAtom, {
      type: "MARK_STALE",
      queryKey: `initiatives:${organizationId}:${projectId}:assignee:${userId}`,
    });

    dispatch(userActionsAtom, {
      type: "MARK_STALE",
      queryKey: `user-workload:${userId}`,
    });
  };

  return {
    invalidateConversationsByCategory,
    invalidateQueriesContainingItem,
    batchInvalidate,
    invalidateUserSpecificData,
  };
};
```

### Advanced Error Handling and Recovery

Implement sophisticated error handling strategies:

```typescript
const useAdvancedErrorHandling = <T>(
  queryHook: () => {
    data: T | null;
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<T>;
  }
) => {
  const [retryCount, setRetryCount] = useState(0);
  const [lastErrorTime, setLastErrorTime] = useState<number | null>(null);
  const maxRetries = 3;

  const { data, isLoading, error, refetch } = queryHook();

  const handleError = useCallback(
    async (error: Error) => {
      const now = Date.now();
      setLastErrorTime(now);

      // Categorize error types
      if (error.message.includes("Network")) {
        // Network errors - try again with backoff
        if (retryCount < maxRetries) {
          const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
          setTimeout(() => {
            setRetryCount((prev) => prev + 1);
            refetch();
          }, delay);
          return;
        }
      } else if (error.message.includes("401")) {
        // Authentication error - redirect to login
        auth.logout();
        navigate("/login");
        return;
      } else if (error.message.includes("403")) {
        // Permission error - show appropriate message
        toast.error("You do not have permission to view this data");
        return;
      }

      // Log error for monitoring
      errorReporting.captureError(error, {
        context: "data-layer",
        retryCount,
        lastErrorTime,
      });
    },
    [retryCount, refetch]
  );

  useEffect(() => {
    if (error) {
      handleError(error);
    } else {
      // Reset retry count on successful load
      setRetryCount(0);
      setLastErrorTime(null);
    }
  }, [error, handleError]);

  const forceRefresh = useCallback(async () => {
    setRetryCount(0);
    setLastErrorTime(null);
    await refetch();
  }, [refetch]);

  return {
    data,
    isLoading,
    error,
    retryCount,
    isRetrying: retryCount > 0 && isLoading,
    canRetry: retryCount < maxRetries,
    forceRefresh,
  };
};
```

These advanced patterns enable you to:

- **Extend the system**: Add new entity types with custom business logic
- **Optimize performance**: Fine-tune caching and request strategies
- **Handle complexity**: Manage relationships and cross-entity updates
- **Control invalidation**: Implement precise cache management
- **Handle errors gracefully**: Provide robust error recovery

The system's flexible architecture supports these advanced use cases while maintaining the simplicity of the basic patterns.

---

## Real-time Integration

The @src/data/ layer provides seamless WebSocket integration that automatically keeps your UI in sync with server-side changes. The QueryKeys architecture makes this both powerful and maintenance-free.

### WebSocket Setup and Connection Management

The system manages WebSocket connections automatically, but you can customize the connection behavior:

```typescript
// WebSocket provider setup (usually in your app root)
const App: React.FC = () => {
  return (
    <WebSocketProvider
      url={process.env.REACT_APP_WEBSOCKET_URL}
      options={{
        reconnectInterval: 5000,
        maxReconnectAttempts: 10,
        heartbeatInterval: 30000,
        enableAutoReconnect: true,
      }}
    >
      <AuthProvider>
        <DataProvider>
          <Router>
            <Routes>{/* Your app routes */}</Routes>
          </Router>
        </DataProvider>
      </AuthProvider>
    </WebSocketProvider>
  );
};

// WebSocket connection status
const ConnectionStatus: React.FC = () => {
  const { isConnected, connectionState, lastError } = useWebSocketConnection();

  return (
    <div className="connection-status">
      <div className={`status-indicator ${connectionState}`}>
        {connectionState === "connected" && "🟢 Connected"}
        {connectionState === "connecting" && "🟡 Connecting..."}
        {connectionState === "disconnected" && "🔴 Disconnected"}
        {connectionState === "error" && "❌ Error"}
      </div>

      {lastError && (
        <div className="error-message">
          Connection error: {lastError.message}
        </div>
      )}
    </div>
  );
};
```

### Component-Level WebSocket Subscriptions

Components automatically subscribe to real-time updates for the data they display:

```typescript
const ConversationList: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { conversations, isLoading } = useConversations(
    organizationId,
    projectId
  );

  // Automatic WebSocket subscriptions based on loaded data
  useWebsocketSubscriptions({
    conversationIds: conversations?.map((c) => c.id) || [],
    projectIds: [projectId],
    // Subscriptions automatically update when conversations change
    enabled: !!conversations?.length,
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="conversation-list">
      {conversations?.map((conversation) => (
        <ConversationCard
          key={conversation.id}
          conversation={conversation}
          // Component automatically re-renders when WebSocket updates arrive
        />
      ))}

      {/* Real-time status indicator */}
      <div className="realtime-status">
        <RealtimeIndicator entityIds={conversations?.map((c) => c.id)} />
      </div>
    </div>
  );
};

// Manual subscription control for specific use cases
const CustomSubscriptionComponent: React.FC = () => {
  const [activeConversations, setActiveConversations] = useState<string[]>([]);
  const [subscriptionEnabled, setSubscriptionEnabled] = useState(true);

  useWebsocketSubscriptions({
    conversationIds: activeConversations,
    initiativeIds: [], // Can subscribe to multiple entity types
    enabled: subscriptionEnabled && activeConversations.length > 0,
  });

  return (
    <div>
      <div className="subscription-controls">
        <button
          onClick={() => setSubscriptionEnabled(!subscriptionEnabled)}
          className={`toggle-button ${
            subscriptionEnabled ? "active" : "inactive"
          }`}
        >
          {subscriptionEnabled ? "Disable" : "Enable"} Real-time Updates
        </button>
      </div>

      <ConversationSelector
        onSelectionChange={setActiveConversations}
        selectedIds={activeConversations}
      />
    </div>
  );
};
```

### WebSocket Event Handling (Internal System)

The system handles WebSocket events internally, but understanding the flow helps with debugging:

```typescript
// Internal WebSocket event handler (for reference - you don't need to implement this)
class WebSocketHandler {
  private handleConversationUpdated(event: WebSocketConversationUpdatedEvent) {
    // Skip updates from current user to prevent loops
    if (this.currentUserId && event.data?.updatedBy === this.currentUserId) {
      console.log("[WS] Skipping own update to prevent loop");
      return;
    }

    // The revolutionary part: ONE simple action handles everything!
    this.dispatchConversation({
      type: "MARK_ITEM_STALE",
      itemId: event.conversationId,
    });

    // This automatically invalidates ALL queries that loaded this conversation
    // No matter what filters, searches, or views they represent
    console.log(`[WS] Marked conversation ${event.conversationId} as stale`);
  }

  private handleConversationCreated(event: WebSocketConversationCreatedEvent) {
    // For new items, invalidate parent collection queries
    this.dispatchConversation({
      type: "MARK_STALE",
      queryKey: `conversations:${event.organizationId}:${event.projectId}::`,
    });

    // Also invalidate any filtered views that might include this new item
    if (event.data?.category) {
      this.dispatchConversation({
        type: "MARK_STALE",
        queryKey: `conversations:${event.organizationId}:${event.projectId}:${event.data.category}:`,
      });
    }
  }

  private handleBatchUpdate(event: WebSocketBatchUpdateEvent) {
    // Efficiently handle bulk operations
    if (event.entityType === "conversation") {
      this.dispatchConversation({
        type: "MARK_ITEMS_STALE",
        itemIds: event.entityIds,
      });
    }

    // System automatically determines which queries to invalidate
    console.log(
      `[WS] Batch invalidated ${event.entityIds.length} conversations`
    );
  }
}
```

### Real-time UI Updates and Feedback

Provide users with feedback about real-time updates:

```typescript
const RealtimeConversationCard: React.FC<{ conversation: Conversation }> = ({
  conversation,
}) => {
  const [justUpdated, setJustUpdated] = useState(false);
  const [updateAnimation, setUpdateAnimation] = useState(false);

  const prevConversation = usePrevious(conversation);

  // Detect when conversation was updated via WebSocket
  useEffect(() => {
    if (
      prevConversation &&
      conversation.updatedAt !== prevConversation.updatedAt
    ) {
      setJustUpdated(true);
      setUpdateAnimation(true);

      // Clear indicators after animation
      const timer = setTimeout(() => {
        setJustUpdated(false);
        setUpdateAnimation(false);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [conversation, prevConversation]);

  return (
    <div className={`conversation-card ${updateAnimation ? "updated" : ""}`}>
      <div className="conversation-header">
        <h3>{conversation.title}</h3>

        {justUpdated && (
          <div className="update-indicator">
            <span className="pulse-dot" />
            Updated
          </div>
        )}
      </div>

      <div className="conversation-content">
        <p>{conversation.summary}</p>
        <div className="conversation-meta">
          <span>
            Updated: {formatDistanceToNow(new Date(conversation.updatedAt))} ago
          </span>
        </div>
      </div>
    </div>
  );
};

// Real-time status indicator for connection health
const RealtimeIndicator: React.FC<{ entityIds: string[] }> = ({
  entityIds,
}) => {
  const { isConnected } = useWebSocketConnection();
  const [recentActivity, setRecentActivity] = useState(false);

  // Subscribe to updates for these entities
  useWebsocketSubscriptions({
    conversationIds: entityIds,
    enabled: isConnected,
  });

  // Track recent WebSocket activity
  useEffect(() => {
    const handler = () => {
      setRecentActivity(true);
      setTimeout(() => setRecentActivity(false), 3000);
    };

    // Listen for WebSocket events (implementation depends on your WebSocket setup)
    window.addEventListener("websocket-activity", handler);
    return () => window.removeEventListener("websocket-activity", handler);
  }, []);

  if (!isConnected) {
    return (
      <div className="realtime-indicator offline">
        <span className="status-dot offline" />
        Real-time updates offline
      </div>
    );
  }

  return (
    <div className="realtime-indicator online">
      <span className={`status-dot online ${recentActivity ? "active" : ""}`} />
      Real-time updates active
      {recentActivity && <span className="activity-pulse" />}
    </div>
  );
};
```

### Handling Optimistic Updates with WebSocket Conflicts

Manage conflicts between optimistic updates and WebSocket events:

```typescript
const useOptimisticWithConflictResolution = () => {
  const [pendingUpdates, setPendingUpdates] = useState<Map<string, any>>(
    new Map()
  );

  const optimisticUpdate = async <T>(
    itemId: string,
    updater: (item: T) => T,
    apiCall: () => Promise<T>
  ) => {
    // Track this as a pending update
    setPendingUpdates((prev) => new Map(prev).set(itemId, Date.now()));

    try {
      // Apply optimistic update
      dispatch(actionsAtom, {
        type: "OPTIMISTIC_UPDATE",
        id: itemId,
        updater,
      });

      // Make API call
      const result = await apiCall();

      // Success - commit the change
      dispatch(actionsAtom, {
        type: "SET_ITEM",
        item: result,
        queryKey: `item:${itemId}`,
      });

      // Clear pending status
      setPendingUpdates((prev) => {
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });

      return result;
    } catch (error) {
      // Rollback optimistic update
      dispatch(actionsAtom, {
        type: "ROLLBACK_OPTIMISTIC",
        id: itemId,
      });

      // Clear pending status
      setPendingUpdates((prev) => {
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });

      throw error;
    }
  };

  // Handle WebSocket events during optimistic updates
  const handleWebSocketUpdate = useCallback(
    (itemId: string, serverData: any) => {
      const updateTime = pendingUpdates.get(itemId);

      if (updateTime) {
        // We have a pending optimistic update
        const timeSinceUpdate = Date.now() - updateTime;

        if (timeSinceUpdate < 5000) {
          // 5 second window
          console.log(
            `[WS] Deferring server update for ${itemId} due to recent optimistic update`
          );

          // Defer server update briefly to let optimistic update complete
          setTimeout(() => {
            handleWebSocketUpdate(itemId, serverData);
          }, 1000);
          return;
        }
      }

      // Apply server update
      dispatch(actionsAtom, {
        type: "SET_ITEM",
        item: serverData,
        queryKey: `item:${itemId}`,
      });
    },
    [pendingUpdates]
  );

  return {
    optimisticUpdate,
    handleWebSocketUpdate,
    hasPendingUpdates: pendingUpdates.size > 0,
    pendingUpdateIds: Array.from(pendingUpdates.keys()),
  };
};
```

### WebSocket Event Filtering and Batching

Optimize WebSocket event processing for performance:

```typescript
const useWebSocketOptimization = () => {
  const [eventQueue, setEventQueue] = useState<WebSocketEvent[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Batch events to reduce re-renders
  const batchEvents = useMemo(
    () =>
      debounce((events: WebSocketEvent[]) => {
        processEventBatch(events);
      }, 100),
    []
  );

  const processEvent = useCallback((event: WebSocketEvent) => {
    setEventQueue((prev) => [...prev, event]);
  }, []);

  useEffect(() => {
    if (eventQueue.length > 0 && !isProcessing) {
      setIsProcessing(true);
      batchEvents([...eventQueue]);
      setEventQueue([]);
      setIsProcessing(false);
    }
  }, [eventQueue, batchEvents, isProcessing]);

  const processEventBatch = (events: WebSocketEvent[]) => {
    // Group events by type and entity
    const eventGroups = events.reduce((groups, event) => {
      const key = `${event.type}:${event.entityType}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(event);
      return groups;
    }, {} as Record<string, WebSocketEvent[]>);

    // Process each group efficiently
    Object.entries(eventGroups).forEach(([key, groupEvents]) => {
      const [eventType, entityType] = key.split(":");

      if (eventType === "BATCH_UPDATE") {
        // Handle batch updates efficiently
        const entityIds = groupEvents.map((e) => e.entityId);
        dispatch(getCollectionForEntity(entityType).actionsAtom, {
          type: "MARK_ITEMS_STALE",
          itemIds: entityIds,
        });
      } else {
        // Handle individual updates
        groupEvents.forEach((event) => {
          handleIndividualEvent(event);
        });
      }
    });

    console.log(
      `[WS] Processed ${events.length} events in ${
        Object.keys(eventGroups).length
      } groups`
    );
  };

  return { processEvent };
};
```

### User Context and Permission Filtering

Ensure WebSocket updates respect user permissions:

```typescript
const usePermissionAwareWebSocket = () => {
  const { user, permissions } = useAuth();

  useEffect(() => {
    if (!user) return;

    const wsHandler = new WebSocketHandler({
      userId: user.id,
      organizationId: user.organizationId,
      permissions: permissions,

      // Filter events based on user permissions
      eventFilter: (event: WebSocketEvent) => {
        // Always allow updates for own actions (to prevent loops)
        if (event.userId === user.id) return false;

        // Check entity-level permissions
        if (event.entityType === "conversation") {
          return permissions.canRead("conversation", event.entityId);
        }

        if (event.entityType === "initiative") {
          return permissions.canRead("initiative", event.entityId);
        }

        return true;
      },

      // Custom event handlers
      onEventReceived: (event) => {
        console.log(
          `[WS] Received ${event.type} for ${event.entityType}:${event.entityId}`
        );
      },

      onEventFiltered: (event, reason) => {
        console.log(
          `[WS] Filtered ${event.type} for ${event.entityType}:${event.entityId} - ${reason}`
        );
      },
    });

    return () => wsHandler.disconnect();
  }, [user, permissions]);
};
```

The real-time integration provides:

- **Automatic subscriptions**: Components automatically subscribe to updates for displayed data
- **Conflict resolution**: Optimistic updates work seamlessly with WebSocket events
- **Performance optimization**: Event batching and filtering prevent unnecessary re-renders
- **Permission awareness**: Updates respect user permissions and context
- **Connection resilience**: Automatic reconnection and error handling
- **Visual feedback**: Users see real-time update indicators and connection status

The QueryKeys architecture makes real-time updates both powerful and maintenance-free - when data changes on the server, all relevant UI components automatically update without any manual subscription management.

---

## Performance Anti-patterns and Best Practices

This section covers common performance mistakes that can severely impact your application, particularly when working with hooks and state management.

### useState vs useRef: The Re-render Problem

One of the most critical performance anti-patterns is using `useState` for internal state tracking that doesn't need to trigger UI updates.

#### ❌ WRONG: useState for Internal Flags (Causes Re-render Cascade)

```typescript
const usePollingExample = () => {
  const [isPolling, setIsPolling] = useState(false); // ❌ Problem!
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!isPolling && shouldStartPolling) {
      setIsPolling(true); // 🚨 This triggers a re-render!

      const interval = setInterval(() => {
        // The re-render above can cause this effect to run again
        // due to changing dependencies, creating a cascade of:
        // state change → re-render → effect runs → state change → re-render...
        fetchData();
      }, 1000);

      return () => {
        clearInterval(interval);
        setIsPolling(false); // 🚨 Another re-render!
      };
    }
  }, [isPolling, shouldStartPolling, retryCount]); // Dependencies can change due to re-renders
};
```

**Problems with this approach:**

- Every `setIsPolling(true/false)` call triggers a re-render
- Re-renders can cause `useEffect` dependencies to change
- This creates cascading re-renders: state change → re-render → effect runs → state change...
- Component constantly re-renders just to track internal polling state
- Performance degrades with complex components and multiple polling hooks
- Can cause infinite re-render loops in worst cases

#### ✅ CORRECT: useRef for Internal State (No Re-renders)

```typescript
const usePollingExample = () => {
  const isPolling = useRef(false); // ✅ No re-renders!
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!isPolling.current && shouldStartPolling) {
      isPolling.current = true; // ✅ No re-render triggered

      const interval = setInterval(() => {
        // Component stays stable, no cascade of re-renders
        fetchData();
      }, 1000);

      return () => {
        clearInterval(interval);
        isPolling.current = false; // ✅ Still no re-render
      };
    }
  }, [shouldStartPolling, retryCount]); // Stable dependencies
};
```

**Benefits of this approach:**

- `isPolling.current = true/false` doesn't trigger re-renders
- Component remains stable during polling operations
- `useEffect` dependencies remain stable, preventing effect loops
- Much better performance, especially with multiple polling hooks
- Internal state tracking without UI impact

### When to Use useState vs useRef

Use this decision matrix:

```typescript
// ✅ useState: When users need to see this state in the UI
const [isLoading, setIsLoading] = useState(false); // User sees spinner
const [error, setError] = useState(null); // User sees error message
const [selectedTab, setSelectedTab] = useState(0); // User sees active tab

// ✅ useRef: For internal state that users don't need to see
const isPolling = useRef(false); // Internal polling tracker
const retryCount = useRef(0); // Internal retry counter
const lastFetchTime = useRef(null); // Internal timing
const abortController = useRef(null); // Internal API control
const previousValue = useRef(undefined); // Internal comparison tracking
```

### Real-World Example: Polling Hook Performance

Here's a comparison of a real polling hook implementation:

```typescript
// ❌ WRONG: Causes excessive re-renders
const useConversationPolling = (conversationId: string) => {
  const [isPolling, setIsPolling] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [lastPollTime, setLastPollTime] = useState<Date | null>(null);

  useEffect(() => {
    // Every state change above triggers this effect
    // Component re-renders constantly during polling
    if (conversationId && !isPolling) {
      setIsPolling(true); // Re-render #1

      const poll = async () => {
        setRetryCount((prev) => prev + 1); // Re-render #2
        setLastPollTime(new Date()); // Re-render #3
        // ... polling logic
      };

      const interval = setInterval(poll, 2000);
      return () => {
        clearInterval(interval);
        setIsPolling(false); // Re-render #4
        setRetryCount(0); // Re-render #5
      };
    }
  }, [conversationId, isPolling, retryCount]); // Constantly changing dependencies
};

// ✅ CORRECT: Minimal re-renders
const useConversationPolling = (conversationId: string) => {
  const isPolling = useRef(false);
  const retryCount = useRef(0);
  const lastPollTime = useRef<Date | null>(null);

  // Only re-render when actual data changes that user sees
  const [conversation, setConversation] = useState<Conversation | null>(null);

  useEffect(() => {
    if (conversationId && !isPolling.current) {
      isPolling.current = true; // No re-render

      const poll = async () => {
        retryCount.current += 1; // No re-render
        lastPollTime.current = new Date(); // No re-render

        const data = await fetchConversation(conversationId);
        setConversation(data); // Only re-render when data actually changes
      };

      const interval = setInterval(poll, 2000);
      return () => {
        clearInterval(interval);
        isPolling.current = false; // No re-render
        retryCount.current = 0; // No re-render
      };
    }
  }, [conversationId]); // Stable dependency

  return { conversation }; // Only the data users actually see
};
```

### Performance Impact Measurements

The performance difference is dramatic:

```typescript
// ❌ WRONG approach with useState:
// - 15-20 re-renders per minute during active polling
// - Each re-render cascades through child components
// - Memory usage grows with component tree size
// - Can cause UI stuttering and poor user experience

// ✅ CORRECT approach with useRef:
// - 1-2 re-renders per minute (only when data actually changes)
// - Minimal cascade to child components
// - Stable memory usage
// - Smooth user experience
```

### Other Performance Anti-patterns

#### ❌ Using useState for Derived State

```typescript
// WRONG: Re-renders for derived calculations
const [items, setItems] = useState([]);
const [filteredItems, setFilteredItems] = useState([]); // ❌ Derived state!

useEffect(() => {
  setFilteredItems(items.filter((item) => item.isActive)); // Unnecessary re-render
}, [items]);
```

```typescript
// CORRECT: Use useMemo for derived state
const [items, setItems] = useState([]);
const filteredItems = useMemo(
  () => items.filter((item) => item.isActive),
  [items]
); // No extra re-renders
```

#### ❌ useState for Event Handlers and Timers

```typescript
// WRONG: Re-renders for timer tracking
const [timerId, setTimerId] = useState<NodeJS.Timeout | null>(null);

const startTimer = () => {
  const id = setTimeout(() => {}, 1000);
  setTimerId(id); // Unnecessary re-render
};
```

```typescript
// CORRECT: useRef for timer references
const timerRef = useRef<NodeJS.Timeout | null>(null);

const startTimer = () => {
  const id = setTimeout(() => {}, 1000);
  timerRef.current = id; // No re-render
};
```

### Key Takeaway

**Rule of thumb: If the user doesn't need to see it, don't put it in useState.**

- `useState`: For state that affects what users see (UI state)
- `useRef`: For state that affects how your component works internally (internal state)

This distinction is crucial for building performant React applications, especially when working with complex state management systems like the @src/data/ layer.

---

## Testing & Debugging

The @src/data/ layer includes comprehensive testing utilities and debugging tools to ensure reliable operation in production environments.

### Testing Collections

Test collection behavior and QueryKeys accumulation with dedicated test utilities:

```typescript
import { createStore } from "jotai";
import { conversationCollection } from "@src/data/collections/conversations";

describe("Conversation Collection", () => {
  let testStore: ReturnType<typeof createStore>;

  beforeEach(() => {
    testStore = createStore();
  });

  it("should accumulate queryKeys across multiple queries", async () => {
    const mockConversation = {
      id: "conv-123",
      title: "Test Conversation",
      organizationId: "org-456",
      projectId: "proj-789",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    // Load from onboarding view
    await testStore.set(conversationCollection.actionsAtom, {
      type: "SET_ITEMS",
      items: [mockConversation],
      queryKey: "conversations:org-456:proj-789:onboarding:",
    });

    // Load from project overview
    await testStore.set(conversationCollection.actionsAtom, {
      type: "SET_ITEMS",
      items: [mockConversation],
      queryKey: "conversations:org-456:proj-789::",
    });

    // Verify QueryKeys accumulation
    const state = testStore.get(conversationCollection.stateAtom);
    const item = state.items.get("conv-123");

    expect(item.queryKeys).toEqual([
      "conversations:org-456:proj-789:onboarding:",
      "conversations:org-456:proj-789::",
    ]);
  });

  it("should invalidate correct queries when item is marked stale", async () => {
    // Set up state with multiple queries
    const conversation = { id: "conv-123", queryKeys: ["query-1", "query-2"] };
    testStore.set(conversationCollection.stateAtom, {
      items: new Map([["conv-123", conversation]]),
      stale: new Set(),
      // ... other state
    });

    // Mark item as stale
    await testStore.set(conversationCollection.actionsAtom, {
      type: "MARK_ITEM_STALE",
      itemId: "conv-123",
    });

    // Verify both queries were marked stale
    const state = testStore.get(conversationCollection.stateAtom);
    expect(state.stale.has("query-1")).toBe(true);
    expect(state.stale.has("query-2")).toBe(true);
  });

  it("should handle optimistic updates and rollbacks", async () => {
    const originalConversation = {
      id: "conv-123",
      title: "Original Title",
      queryKeys: ["test-query"],
    };

    // Set initial state
    testStore.set(conversationCollection.stateAtom, {
      items: new Map([["conv-123", originalConversation]]),
      optimisticUpdates: new Map(),
      // ... other state
    });

    // Apply optimistic update
    await testStore.set(conversationCollection.actionsAtom, {
      type: "OPTIMISTIC_UPDATE",
      id: "conv-123",
      updater: (item) => ({ ...item, title: "Updated Title" }),
    });

    let state = testStore.get(conversationCollection.stateAtom);
    expect(state.items.get("conv-123").title).toBe("Updated Title");
    expect(state.optimisticUpdates.has("conv-123")).toBe(true);

    // Rollback optimistic update
    await testStore.set(conversationCollection.actionsAtom, {
      type: "ROLLBACK_OPTIMISTIC",
      id: "conv-123",
    });

    state = testStore.get(conversationCollection.stateAtom);
    expect(state.items.get("conv-123").title).toBe("Original Title");
    expect(state.optimisticUpdates.has("conv-123")).toBe(false);
  });
});
```

### Testing Hooks with React Testing Library

Test hook behavior and component integration:

```typescript
import { renderHook, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai";
import { useConversations } from "@src/data/hooks/useConversations";

const createWrapper = () => {
  const testStore = createStore();

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Provider store={testStore}>{children}</Provider>
  );

  return { Wrapper, testStore };
};

describe("useConversations Hook", () => {
  it("should handle loading states correctly", async () => {
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () => useConversations("org-123", "proj-456"),
      { wrapper: Wrapper }
    );

    // Initially loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.conversations).toBeNull();

    // Wait for loading to complete
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.conversations).toBeDefined();
  });

  it("should refetch data when refetch is called", async () => {
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () => useConversations("org-123", "proj-456"),
      { wrapper: Wrapper }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Trigger refetch
    const refetchPromise = result.current.refetch();

    // Should be loading again
    expect(result.current.isLoading).toBe(true);

    await refetchPromise;

    // Should complete loading
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("should handle conditional fetching", () => {
    const { Wrapper } = createWrapper();

    const { result, rerender } = renderHook(
      ({ enabled }) => useConversations("org-123", "proj-456", { enabled }),
      {
        wrapper: Wrapper,
        initialProps: { enabled: false },
      }
    );

    // Should not be loading when disabled
    expect(result.current.isLoading).toBe(false);
    expect(result.current.conversations).toBeNull();

    // Enable fetching
    rerender({ enabled: true });

    // Should now be loading
    expect(result.current.isLoading).toBe(true);
  });
});
```

### Integration Testing with WebSocket Events

Test the complete flow from WebSocket events to UI updates:

```typescript
import { render, screen } from "@testing-library/react";
import { WebSocketTestProvider } from "@src/test-utils/WebSocketTestProvider";
import { ConversationList } from "@src/components/ConversationList";

describe("WebSocket Integration", () => {
  it("should update UI when WebSocket event is received", async () => {
    const { mockWebSocket } = render(
      <WebSocketTestProvider>
        <ConversationList organizationId="org-123" projectId="proj-456" />
      </WebSocketTestProvider>
    );

    // Wait for initial data load
    await waitFor(() => {
      expect(screen.getByText("Test Conversation")).toBeInTheDocument();
    });

    // Simulate WebSocket update
    mockWebSocket.emit("conversation_updated", {
      conversationId: "conv-123",
      data: {
        title: "Updated Conversation Title",
        updatedAt: new Date().toISOString(),
      },
    });

    // Verify UI updated
    await waitFor(() => {
      expect(
        screen.getByText("Updated Conversation Title")
      ).toBeInTheDocument();
    });
  });

  it("should handle WebSocket disconnection gracefully", async () => {
    const { mockWebSocket } = render(
      <WebSocketTestProvider>
        <ConversationList organizationId="org-123" projectId="proj-456" />
      </WebSocketTestProvider>
    );

    // Simulate disconnection
    mockWebSocket.disconnect();

    // Should show offline indicator
    await waitFor(() => {
      expect(screen.getByText(/Real-time updates offline/)).toBeInTheDocument();
    });

    // Reconnect
    mockWebSocket.connect();

    // Should show online indicator
    await waitFor(() => {
      expect(screen.getByText(/Real-time updates active/)).toBeInTheDocument();
    });
  });
});
```

### Built-in Debugging Tools

The system includes comprehensive debugging utilities:

```typescript
// Debug query state for troubleshooting
const useQueryDebugger = (queryKey: string) => {
  const state = useAtomValue(conversationCollection.stateAtom);

  const debugInfo = useMemo(() => {
    const itemsWithQuery = Array.from(state.items.values()).filter((item) =>
      item.queryKeys?.includes(queryKey)
    );

    return {
      queryKey,
      isStale: state.stale.has(queryKey),
      isLoading: state.loading.has(queryKey),
      isFetched: state.fetched.has(queryKey),
      hasError: state.errors.has(queryKey),
      error: state.errors.get(queryKey),
      itemCount: itemsWithQuery.length,
      items: itemsWithQuery,
      listQueryIds: state.listQueries.get(queryKey),
      singleQueryId: state.singleQueries.get(queryKey),
    };
  }, [state, queryKey]);

  // Log debug info when it changes
  useEffect(() => {
    console.log(`[DEBUG] Query State for ${queryKey}:`, debugInfo);
  }, [debugInfo, queryKey]);

  return debugInfo;
};

// Usage in components
const DebuggableConversationList: React.FC = () => {
  const { conversations, isLoading, error } = useConversations(
    "org-123",
    "proj-456"
  );
  const debugInfo = useQueryDebugger("conversations:org-123:proj-456::");

  return (
    <div>
      <div className="debug-panel">
        <h4>Debug Info</h4>
        <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
      </div>

      <ConversationList
        conversations={conversations}
        isLoading={isLoading}
        error={error}
      />
    </div>
  );
};

// Global debug helpers
window.debugDataLayer = {
  // Inspect all collections
  inspectCollections: () => {
    console.log("Available collections:", {
      conversations: conversationCollection._staleTimeState,
      projects: projectCollection._staleTimeState,
      initiatives: initiativeCollection._staleTimeState,
    });
  },

  // Force invalidate all queries for testing
  invalidateAll: () => {
    [conversationCollection, projectCollection, initiativeCollection].forEach(
      (collection) => {
        store.set(collection.actionsAtom, { type: "MARK_ALL_STALE" });
      }
    );
  },

  // Show QueryKeys for a specific item
  showQueryKeys: (itemId: string) => {
    const collections = [
      conversationCollection,
      projectCollection,
      initiativeCollection,
    ];

    collections.forEach((collection) => {
      const state = store.get(collection.stateAtom);
      const item = state.items.get(itemId);
      if (item) {
        console.log(
          `[${collection.name}] Item ${itemId} queryKeys:`,
          item.queryKeys
        );
      }
    });
  },
};
```

### Performance Monitoring and Debugging

Monitor system performance and identify bottlenecks:

```typescript
// Performance monitoring hook
const usePerformanceMonitor = () => {
  const [metrics, setMetrics] = useState<{
    queryCount: number;
    averageResponseTime: number;
    cacheHitRate: number;
    recentQueries: Array<{
      queryKey: string;
      duration: number;
      cached: boolean;
    }>;
  }>({
    queryCount: 0,
    averageResponseTime: 0,
    cacheHitRate: 0,
    recentQueries: [],
  });

  const trackQuery = useCallback(
    (queryKey: string, duration: number, cached: boolean) => {
      setMetrics((prev) => {
        const newQueries = [
          { queryKey, duration, cached },
          ...prev.recentQueries.slice(0, 99), // Keep last 100 queries
        ];

        const totalQueries = newQueries.length;
        const averageResponseTime =
          newQueries.reduce((sum, q) => sum + q.duration, 0) / totalQueries;
        const cacheHits = newQueries.filter((q) => q.cached).length;
        const cacheHitRate = cacheHits / totalQueries;

        return {
          queryCount: totalQueries,
          averageResponseTime,
          cacheHitRate,
          recentQueries: newQueries,
        };
      });
    },
    []
  );

  return { metrics, trackQuery };
};

// Performance debugging component
const PerformanceDebugger: React.FC = () => {
  const { metrics } = usePerformanceMonitor();
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="performance-debugger">
      <div className="metrics-summary">
        <div className="metric">
          <label>Queries:</label>
          <span>{metrics.queryCount}</span>
        </div>
        <div className="metric">
          <label>Avg Response:</label>
          <span>{metrics.averageResponseTime.toFixed(0)}ms</span>
        </div>
        <div className="metric">
          <label>Cache Hit Rate:</label>
          <span>{(metrics.cacheHitRate * 100).toFixed(1)}%</span>
        </div>

        <button onClick={() => setShowDetails(!showDetails)}>
          {showDetails ? "Hide" : "Show"} Details
        </button>
      </div>

      {showDetails && (
        <div className="query-details">
          <h4>Recent Queries</h4>
          {metrics.recentQueries.slice(0, 10).map((query, index) => (
            <div key={index} className="query-detail">
              <span className="query-key">{query.queryKey}</span>
              <span className="duration">{query.duration}ms</span>
              <span className={`cache-status ${query.cached ? "hit" : "miss"}`}>
                {query.cached ? "CACHED" : "FETCH"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

### Common Issues and Troubleshooting

Guide for debugging frequent problems:

```typescript
// Troubleshooting checklist
const DataLayerTroubleshooting = {
  // Issue: Data not updating after WebSocket events
  staleDataAfterWebSocket: {
    problem: "Data doesn't update when WebSocket events arrive",
    checks: [
      "Verify WebSocket connection is active",
      "Check if user filtering is preventing updates",
      "Confirm QueryKeys are accumulating correctly",
      "Verify WebSocket event structure matches expected format",
    ],
    debugging: `
      // Check WebSocket connection
      const { isConnected } = useWebSocketConnection();
      console.log('WebSocket connected:', isConnected);

      // Check QueryKeys accumulation
      const debugInfo = useQueryDebugger(queryKey);
      console.log('QueryKeys for item:', debugInfo.items[0]?.queryKeys);

      // Verify WebSocket subscriptions
      useWebsocketSubscriptions({
        conversationIds: conversations?.map(c => c.id) || [],
        debug: true // Enable debug logging
      });
    `,
  },

  // Issue: Excessive re-renders
  performanceIssues: {
    problem: "Components re-rendering too frequently",
    checks: [
      "Check if multiple queries are invalidating simultaneously",
      "Verify stale time configuration is appropriate",
      "Look for unnecessary query key changes",
      "Check for missing memoization in components",
    ],
    debugging: `
      // Monitor re-renders
      const renderCount = useRef(0);
      renderCount.current++;
      console.log('Component rendered', renderCount.current, 'times');

      // Check stale state changes
      const { conversations, isStale } = useConversations(...);
      useEffect(() => {
        console.log('Stale state changed:', isStale);
      }, [isStale]);
    `,
  },

  // Issue: Memory leaks with subscriptions
  memoryLeaks: {
    problem: "Memory usage increasing over time",
    checks: [
      "Verify WebSocket subscriptions are cleaned up",
      "Check for proper component unmounting",
      "Look for listeners not being removed",
      "Confirm optimistic updates are being committed/rolled back",
    ],
    debugging: `
      // Monitor subscription cleanup
      useEffect(() => {
        console.log('Setting up subscriptions');

        return () => {
          console.log('Cleaning up subscriptions');
        };
      }, []);

      // Check for pending optimistic updates
      const state = useAtomValue(conversationCollection.stateAtom);
      console.log('Pending optimistic updates:', state.optimisticUpdates.size);
    `,
  },

  // Issue: Nested hook usage between parent and child components
  nestedHookUsage: {
    problem:
      "Parent and child components both using the same data hook causes issues",
    explanation:
      "Currently, this pattern does NOT work properly and can cause state inconsistencies",
    brokenPattern: `
      // ❌ BROKEN - This pattern currently doesn't work
      const ParentComponent = () => {
        const { data } = useDataHook();

        return (
          <div>
            {/* Parent uses data */}
            <ChildComponent />
          </div>
        );
      };

      const ChildComponent = () => {
        const { create } = useDataHook(); // This breaks the pattern
        // ...
      };
    `,
    solution:
      "Parent component should extract all mutation methods and pass them to child components",
    correctPattern: `
      // ✅ CORRECT - Extract mutations in parent and pass down
      const ParentComponent = () => {
        const { data, create, update, remove } = useDataHook();

        return (
          <div>
            {/* Parent uses data */}
            <ChildComponent
              onCreate={create}
              onUpdate={update}
              onDelete={remove}
            />
          </div>
        );
      };

      const ChildComponent = ({ onCreate, onUpdate, onDelete }) => {
        // Use the passed mutation functions instead of calling the hook
        const handleSubmit = async (formData) => {
          await onCreate(formData);
        };

        // ...
      };
    `,
    reasoning: [
      "Prevents hook state conflicts between parent and child",
      "Ensures single source of truth for data operations",
      "Maintains proper component hierarchy and data flow",
      "Avoids duplicate WebSocket subscriptions and cache invalidation issues",
    ],
  },
};

// Debug component to help identify issues
const DataLayerHealthCheck: React.FC = () => {
  const conversationState = useAtomValue(conversationCollection.stateAtom);
  const projectState = useAtomValue(projectCollection.stateAtom);
  const { isConnected } = useWebSocketConnection();

  const healthMetrics = {
    websocketConnected: isConnected,
    totalItems: conversationState.items.size + projectState.items.size,
    staleQueries: conversationState.stale.size + projectState.stale.size,
    loadingQueries: conversationState.loading.size + projectState.loading.size,
    errorQueries: conversationState.errors.size + projectState.errors.size,
    optimisticUpdates:
      conversationState.optimisticUpdates.size +
      projectState.optimisticUpdates.size,
  };

  const hasIssues =
    !healthMetrics.websocketConnected ||
    healthMetrics.errorQueries > 0 ||
    healthMetrics.optimisticUpdates > 5;

  return (
    <div className={`health-check ${hasIssues ? "warning" : "healthy"}`}>
      <h3>Data Layer Health</h3>
      <div className="metrics">
        {Object.entries(healthMetrics).map(([key, value]) => (
          <div key={key} className="health-metric">
            <span className="label">{key}:</span>
            <span className="value">{String(value)}</span>
          </div>
        ))}
      </div>

      {hasIssues && (
        <div className="warnings">
          <h4>Potential Issues:</h4>
          <ul>
            {!healthMetrics.websocketConnected && (
              <li>WebSocket disconnected</li>
            )}
            {healthMetrics.errorQueries > 0 && (
              <li>{healthMetrics.errorQueries} queries have errors</li>
            )}
            {healthMetrics.optimisticUpdates > 5 && (
              <li>High number of pending optimistic updates</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
```

The testing and debugging tools provide:

- **Comprehensive test coverage**: Unit tests for collections, hooks, and integration flows
- **Performance monitoring**: Real-time metrics and bottleneck identification
- **Debug utilities**: Built-in tools for inspecting state and query behavior
- **Troubleshooting guides**: Solutions for common issues and debugging steps
- **Health monitoring**: System health checks and issue detection

These tools ensure your @src/data/ layer implementation is robust, performant, and maintainable in production environments.

---

## Migration & Integration

This section provides strategies for adopting the @src/data/ layer incrementally in existing codebases and integrating it with legacy systems.

### Integration Strategy

Add the @src/data/ layer to existing applications without disrupting current functionality:

```typescript
// 1. Start by installing the @src/data/ layer alongside existing state management
const ExistingComponent: React.FC = () => {
  // Keep existing state management temporarily
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Add new data layer with feature flag
  const {
    projects: newProjects,
    isLoading,
    isReady,
  } = useProjects(orgId, {
    enabled: FEATURE_FLAGS.useNewDataLayer,
  });

  // Gradually switch over based on feature flag
  const displayProjects = FEATURE_FLAGS.useNewDataLayer
    ? newProjects
    : projects;
  const displayLoading = FEATURE_FLAGS.useNewDataLayer ? isLoading : loading;

  // Legacy data fetching (will be removed later)
  useEffect(() => {
    if (!FEATURE_FLAGS.useNewDataLayer) {
      fetchProjects().then((data) => {
        setProjects(data);
        setLoading(false);
      });
    }
  }, []);

  return (
    <div>
      {displayLoading ? (
        <LoadingSpinner />
      ) : (
        <ProjectList projects={displayProjects} />
      )}
    </div>
  );
};

// 2. Gradually expand usage as confidence builds
const PartiallyMigratedComponent: React.FC = () => {
  // New data layer for critical data
  const { projects } = useProjects(orgId);

  // Legacy system for less critical data (temporary)
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    // Keep legacy patterns for non-critical data temporarily
    legacyApi.getSettings().then(setSettings);
  }, []);

  return (
    <div>
      <ProjectOverview projects={projects} /> {/* New system */}
      <SettingsPanel settings={settings} /> {/* Legacy system */}
    </div>
  );
};
```

### Migration Patterns from Common State Management Solutions

#### Migrating from Redux/RTK Query

```typescript
// BEFORE: Redux/RTK Query pattern
const ProjectsList: React.FC = () => {
  const { data: projects, isLoading, error } = useGetProjectsQuery(orgId);

  return (
    <div>
      {isLoading && <LoadingSpinner />}
      {error && <ErrorMessage error={error} />}
      {projects?.map(project => <ProjectCard key={project.id} project={project} />)}
    </div>
  );
};

// AFTER: @src/data/ layer pattern (nearly identical API)
const ProjectsList: React.FC = () => {
  const { projects, isLoading, error } = useProjects(orgId);

  return (
    <div>
      {isLoading && <LoadingSpinner />}
      {error && <ErrorMessage error={error} />}
      {projects?.map(project => <ProjectCard key={project.id} project={project} />)}
    </div>
  );
};

// Migration helper: Adapter pattern for gradual transition
const createLegacyAdapter = <T>(newHook: () => any) => {
  return () => {
    const result = newHook();

    // Adapt new API to match legacy API expectations
    return {
      data: result.data,
      isLoading: result.isLoading,
      error: result.error,
      refetch: result.refetch,
      // Add any legacy-specific fields if needed
      isFetching: result.isLoading,
      isSuccess: !!result.data && !result.error
    };
  };
};

// Use adapter during transition
const useGetProjectsQuery = createLegacyAdapter(() => useProjects(orgId));
```

#### Migrating from React Query

```typescript
// BEFORE: React Query pattern
const useProjectsRQ = (orgId: string) => {
  return useQuery({
    queryKey: ["projects", orgId],
    queryFn: () => projectsApi.getProjects(orgId),
    staleTime: 5 * 60 * 1000,
  });
};

// AFTER: @src/data/ layer (with similar options)
const useProjectsNew = (orgId: string, options?: { staleTimeMs?: number }) => {
  return useProjects(orgId, {
    enabled: true,
    ...options,
  });
};

// Side-by-side comparison during migration
const MigrationTestComponent: React.FC = () => {
  const legacyResult = useProjectsRQ(orgId);
  const newResult = useProjectsNew(orgId);

  // Compare results in development
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.log("Legacy vs New comparison:", {
        legacy: {
          data: legacyResult.data,
          isLoading: legacyResult.isLoading,
          error: legacyResult.error,
        },
        new: {
          data: newResult.projects,
          isLoading: newResult.isLoading,
          error: newResult.error,
        },
      });
    }
  }, [legacyResult, newResult]);

  // Use new system but fall back to legacy if needed
  const projects = newResult.projects ?? legacyResult.data;
  const isLoading = newResult.isLoading || legacyResult.isLoading;
  const error = newResult.error ?? legacyResult.error;

  return (
    <ProjectList projects={projects} isLoading={isLoading} error={error} />
  );
};
```

### Backward Compatibility Patterns

Maintain compatibility with existing components during transition:

```typescript
// Higher-order component for backward compatibility
const withDataLayer = <P extends object>(
  Component: React.ComponentType<P>,
  dataMapping: {
    [K in keyof P]?: (props: P) => any;
  }
) => {
  return (props: P) => {
    // Inject data layer hooks based on mapping
    const injectedProps = Object.entries(dataMapping).reduce(
      (acc, [key, hookFactory]) => {
        if (hookFactory) {
          acc[key] = hookFactory(props);
        }
        return acc;
      },
      {} as Partial<P>
    );

    return <Component {...props} {...injectedProps} />;
  };
};

// Usage example
const LegacyProjectComponent = ({ projects, isLoading, onRefresh }) => {
  // Existing component code unchanged
  return (
    <div>
      {isLoading ? <Loading /> : <ProjectGrid projects={projects} />}
      <button onClick={onRefresh}>Refresh</button>
    </div>
  );
};

// Enhance with data layer without changing original component
const EnhancedProjectComponent = withDataLayer(LegacyProjectComponent, {
  projects: (props) => useProjects(props.organizationId).projects,
  isLoading: (props) => useProjects(props.organizationId).isLoading,
  onRefresh: (props) => useProjects(props.organizationId).refetch,
});

// Component provider pattern for gradual rollout
const DataLayerProvider: React.FC<{
  children: React.ReactNode;
  enabledFeatures?: string[];
}> = ({ children, enabledFeatures = [] }) => {
  const isFeatureEnabled = (feature: string) =>
    enabledFeatures.includes(feature);

  return (
    <DataLayerContext.Provider value={{ isFeatureEnabled }}>
      {children}
    </DataLayerContext.Provider>
  );
};

// Conditional hook usage based on feature flags
const useConditionalProjects = (orgId: string) => {
  const { isFeatureEnabled } = useContext(DataLayerContext);

  // Use new system if enabled, otherwise return null/loading state
  return isFeatureEnabled("projects-data-layer")
    ? useProjects(orgId)
    : { projects: null, isLoading: false, error: null, refetch: () => {} };
};
```

### Incremental Adoption Strategy

Implement a phased rollout approach:

```typescript
// Phase 1: Shadow mode - New system runs alongside old but doesn't affect UI
const Phase1Component: React.FC = () => {
  // Primary data source (legacy)
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Shadow data source (new system) - for comparison only
  const { projects: shadowProjects, isLoading: shadowLoading } = useProjects(
    orgId,
    {
      enabled: FEATURE_FLAGS.enableShadowMode,
    }
  );

  // Legacy data fetching
  useEffect(() => {
    fetchProjectsLegacy().then((data) => {
      setProjects(data);
      setLoading(false);
    });
  }, []);

  // Compare results in shadow mode
  useEffect(() => {
    if (
      FEATURE_FLAGS.enableShadowMode &&
      !shadowLoading &&
      projects.length > 0
    ) {
      // Log differences for monitoring
      const differences = findDataDifferences(projects, shadowProjects);
      if (differences.length > 0) {
        console.warn("[SHADOW_MODE] Data differences detected:", differences);
        analytics.track("shadow_mode_differences", { differences });
      }
    }
  }, [projects, shadowProjects, shadowLoading]);

  return <ProjectList projects={projects} isLoading={loading} />;
};

// Phase 2: Canary rollout - New system for subset of users
const Phase2Component: React.FC = () => {
  const { user } = useAuth();
  const isCanaryUser = user.id in CANARY_USER_IDS;

  // Route data source based on user segment
  if (isCanaryUser) {
    // Canary users get new system
    return <NewSystemProjectList orgId={orgId} />;
  } else {
    // Everyone else stays on legacy
    return <LegacyProjectList orgId={orgId} />;
  }
};

// Phase 3: Full rollout with legacy fallback
const Phase3Component: React.FC = () => {
  const { projects, isLoading, error } = useProjects(orgId);
  const [legacyProjects, setLegacyProjects] = useState(null);
  const [legacyLoading, setLegacyLoading] = useState(false);

  // Automatic fallback on error
  useEffect(() => {
    if (error && !legacyLoading && !legacyProjects) {
      console.warn("[FALLBACK] New system failed, using legacy:", error);
      setLegacyLoading(true);

      fetchProjectsLegacy()
        .then((data) => {
          setLegacyProjects(data);
          analytics.track("legacy_fallback_triggered", {
            error: error.message,
          });
        })
        .finally(() => setLegacyLoading(false));
    }
  }, [error, legacyLoading, legacyProjects]);

  // Use new system data or fallback to legacy
  const displayProjects = legacyProjects ?? projects;
  const displayLoading = legacyLoading || isLoading;
  const displayError = legacyProjects ? null : error; // Hide error if fallback succeeded

  return (
    <ProjectList
      projects={displayProjects}
      isLoading={displayLoading}
      error={displayError}
    />
  );
};
```

### API Integration with Legacy Services

Integrate the @src/data/ layer with existing backend services:

```typescript
// Wrapper for legacy API to match new system expectations
const createLegacyApiWrapper = (legacyService: LegacyApiService) => {
  return {
    async getProjects(orgId: string): Promise<FetcherResponse<Project>> {
      try {
        // Call legacy service
        const legacyResponse = await legacyService.projects.list({
          organization_id: orgId, // Legacy field naming
        });

        // Transform to new format
        const transformedData = legacyResponse.results.map((item) => ({
          id: item.project_id, // Transform field names
          name: item.project_name,
          organizationId: item.organization_id,
          createdAt: item.created_date,
          updatedAt: item.last_modified,
          // Add missing fields with defaults
          status: "ACTIVE",
          description: item.description || "",
        }));

        return {
          isArray: true,
          data: transformedData,
        };
      } catch (error) {
        // Transform legacy errors to new format
        throw new Error(`Legacy API Error: ${error.message}`);
      }
    },
  };
};

// Use wrapper in collection
export const legacyProjectCollection = createCollection<Project>({
  name: "legacyProjects",
  fetcher: async (queryKey: string) => {
    const wrapper = createLegacyApiWrapper(legacyApiService);
    const [, orgId] = queryKey.split(":");
    return wrapper.getProjects(orgId);
  },
  // More conservative settings for legacy integration
  staleTimeMs: 60000, // 1 minute
  dedupeTime: 2000, // 2 seconds
});

// Gradual endpoint migration
const createHybridApiService = (legacyApi: LegacyApi, newApi: NewApi) => {
  return {
    async getProjects(orgId: string) {
      // Feature flag to control which API to use
      if (FEATURE_FLAGS.useNewProjectsApi) {
        try {
          return await newApi.projects.list(orgId);
        } catch (error) {
          console.warn("[API_FALLBACK] New API failed, using legacy:", error);
          // Fallback to legacy API
          return await legacyApi.getProjects(orgId);
        }
      } else {
        return await legacyApi.getProjects(orgId);
      }
    },
  };
};
```

### Common Migration Pitfalls and Solutions

Avoid these common issues during migration:

```typescript
// PITFALL 1: Different data shapes between old and new systems
// SOLUTION: Use data transformation layer

const useProjectsWithTransform = (orgId: string) => {
  const { projects, isLoading, error } = useProjects(orgId);

  // Transform data to match legacy component expectations
  const transformedProjects = useMemo(() => {
    if (!projects) return null;

    return projects.map(project => ({
      // Legacy component expects these fields
      projectId: project.id,
      projectName: project.name,
      orgId: project.organizationId,
      createdDate: project.createdAt,
      lastModified: project.updatedAt,
      // New fields
      ...project
    }));
  }, [projects]);

  return {
    projects: transformedProjects,
    isLoading,
    error
  };
};

// PITFALL 2: Different loading state management
// SOLUTION: Create compatibility layer

const useLegacyCompatibleLoading = (dataHook: () => any) => {
  const result = dataHook();

  return {
    ...result,
    // Legacy components expect different loading field names
    loading: result.isLoading,
    fetching: result.isLoading,
    pending: result.isLoading,
    // Legacy error handling
    hasError: !!result.error,
    errorMessage: result.error?.message
  };
};

// PITFALL 3: Breaking changes in hook signatures
// SOLUTION: Maintain backward compatible wrappers

const useProjectsV1 = (orgId: string) => {
  // Old signature: single parameter
  return useProjects(orgId);
};

const useProjectsV2 = (orgId: string, options?: ProjectOptions) => {
  // New signature: additional options parameter
  return useProjects(orgId, options);
};

// Export both during transition period
export {
  useProjectsV1 as useProjects,      // Legacy import
  useProjectsV2 as useProjectsNew    // New import
};

// PITFALL 4: State synchronization between old and new systems
// SOLUTION: State bridge pattern

const useStateBridge = <T>(
  legacyState: T,
  newHookResult: { data: T | null; isLoading: boolean }
) => {
  const [bridgedState, setBridgedState] = useState<T>(legacyState);

  useEffect(() => {
    // Sync new system data to legacy state when available
    if (newHookResult.data && !newHookResult.isLoading) {
      setBridgedState(newHookResult.data);
    }
  }, [newHookResult.data, newHookResult.isLoading]);

  return bridgedState;
};

// Usage in component
const BridgedComponent: React.FC = () => {
  const [legacyProjects, setLegacyProjects] = useState<Project[]>([]);
  const newProjectsResult = useProjects(orgId);

  // Bridge maintains legacy state while transitioning
  const projects = useStateBridge(legacyProjects, newProjectsResult);

  return <ProjectList projects={projects} />;
};
```

### Migration Checklist

Use this checklist to ensure successful migration:

```typescript
const MigrationChecklist = {
  preparation: [
    "✓ Identify all components using legacy data fetching",
    "✓ Map existing API calls to new collection patterns",
    "✓ Set up feature flags for gradual rollout",
    "✓ Create data transformation layers for API differences",
    "✓ Establish monitoring for data consistency",
  ],

  implementation: [
    "✓ Implement shadow mode for data comparison",
    "✓ Create backward compatibility wrappers",
    "✓ Add error fallback mechanisms",
    "✓ Set up canary rollout infrastructure",
    "✓ Test with subset of users/data",
  ],

  rollout: [
    "✓ Monitor error rates and performance metrics",
    "✓ Compare data consistency between old/new systems",
    "✓ Gather user feedback on any behavior changes",
    "✓ Gradually increase rollout percentage",
    "✓ Remove legacy code after full migration",
  ],

  cleanup: [
    "✓ Remove feature flags and legacy code paths",
    "✓ Update documentation to reflect new patterns",
    "✓ Clean up unused dependencies",
    "✓ Archive legacy API services",
    "✓ Update team training materials",
  ],
};

// Migration status tracking component
const MigrationStatus: React.FC = () => {
  const migrationMetrics = useMigrationMetrics();

  return (
    <div className="migration-dashboard">
      <h3>Data Layer Migration Status</h3>

      <div className="progress-section">
        <h4>Components Migrated</h4>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${migrationMetrics.componentsMigrated}%` }}
          />
        </div>
        <span>{migrationMetrics.componentsMigrated}% complete</span>
      </div>

      <div className="metrics-grid">
        <div className="metric">
          <label>New System Usage:</label>
          <span>{migrationMetrics.newSystemUsage}%</span>
        </div>
        <div className="metric">
          <label>Error Rate:</label>
          <span>{migrationMetrics.errorRate}%</span>
        </div>
        <div className="metric">
          <label>Performance Gain:</label>
          <span>+{migrationMetrics.performanceImprovement}%</span>
        </div>
      </div>
    </div>
  );
};
```

The migration and integration strategies enable:

- **Risk-free adoption**: Shadow mode and canary rollouts minimize risk
- **Backward compatibility**: Legacy components continue working during transition
- **Gradual rollout**: Phase-based approach allows for careful monitoring
- **API flexibility**: Integration with existing backend services
- **Fallback mechanisms**: Automatic recovery when new system encounters issues
- **Data consistency**: Tools to verify data integrity during transition

This comprehensive approach ensures teams can adopt the @src/data/ layer benefits while maintaining system stability and user experience throughout the migration process.

---

## Correlated Activity Client API

Use `useCorrelatedActivity` to read paginated correlated activity data for dropdowns and full activity pages.

```tsx
import { useCorrelatedActivity } from "@hey-hey/ui-common/data";
import { ActivityCorrelationActivityType } from "@hey-hey/ui-common/api";

const { records, pagination, isLoading, error } = useCorrelatedActivity(
  "org-1",
  {
    activityType: [ActivityCorrelationActivityType.Notification],
    limit: 25,
    offset: 0,
    view: "dropdown", // "dropdown" | "full"
    staleTimeMs: 15000, // SWR TTL override for this hook usage
  }
);
```

Behavior:

- Records are mapped to a stable UI model with `activityId`, `activityType`, `source`, `linkedEntities`, and preview variants.
- Duplicate entries are removed client-side and results are lightly prioritized for display.
- Cache uses stale-while-revalidate semantics with configurable TTL.
- Automatic stale-time refetch is disabled by default for this hook.
- Transient upstream failures use basic retry with exponential backoff.
- You can plug in push-driven invalidation with `subscribeToUpdates`.

---

## Conclusion

The @src/data/ layer represents a paradigm shift in React data management, solving fundamental problems that have plagued developers for years:

### What Makes It Revolutionary

1. **QueryKeys Architecture**: Items automatically track which queries loaded them, enabling zero-maintenance cache invalidation
2. **WebSocket Integration**: Real-time updates work automatically without manual pattern tracking
3. **Type-Safe Operations**: Full TypeScript support throughout the entire data flow
4. **Performance Optimization**: Intelligent caching, deduplication, and stale time management
5. **Developer Experience**: Declarative API that eliminates boilerplate and reduces complexity

### The Bottom Line

Before this system:

- WebSocket cache invalidation required manually tracking every possible query pattern
- Adding new filters or views meant updating multiple WebSocket handlers
- Stale data bugs were common and hard to debug
- State management required extensive boilerplate code

With this system:

- WebSocket invalidation is completely automatic and pattern-agnostic
- New features require zero WebSocket handler changes
- Stale data bugs are impossible due to QueryKeys architecture
- State management is declarative and requires minimal code

### Getting Started

1. **Start with the basics**: Use `useProjects()` or `useConversations()` in a simple component
2. **Experience the magic**: See how WebSocket updates automatically refresh your UI
3. **Explore advanced features**: Try optimistic updates and custom collections
4. **Appreciate the architecture**: Notice how QueryKeys eliminate entire categories of bugs

The @src/data/ layer isn't just another state management solution - it's a fundamental rethinking of how React applications should handle data. The QueryKeys innovation alone makes it worth adopting, as it eliminates an entire category of maintenance overhead that plagues traditional approaches.

**Ready to revolutionize your data management?** Start with the Quick Start examples and experience the difference for yourself.

---
