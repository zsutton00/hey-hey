# Custom Hooks

This directory contains custom React hooks that encapsulate business logic and state management for the ProjectSetup functionality.

## Hooks

### `useUserIdentity`

- **Purpose**: Decodes JWT tokens to extract user identity information and provide access to current organization details
- **Returns**:
  - `UserIdentity | null`: User identity object or null if no token/invalid token
    - `userId`: User's unique identifier
    - `email`: User's email address
    - `currentOrgId`: ID of the user's current organization
    - `orgMemberships`: Array of organization memberships with roles
    - `isDevAdmin`: Whether user is a dev admin
    - `devAdminMode`: Whether dev admin mode is enabled
    - `isTokenExpired`: Whether the JWT token is expired
    - `currentOrgRole`: User's role in the current organization
- **Responsibilities**:
  - Decoding JWT tokens without external dependencies
  - Extracting user identity information
  - Providing current organization context
  - Checking token expiration status
  - Determining user's role in current organization
- **Usage**: Import and use in components that need user/organization context

### `useProjects`

- **Purpose**: Manages all project-related operations and state
- **Returns**:
  - `projects`: Array of all projects
  - `loading`: Loading state for create operations
  - `error`: Error message string
  - `fetchingProjects`: Loading state for initial fetch
  - `createProject`: Function to create a new project
  - `selectProject`: Function to navigate to a project
  - `deleteProject`: Function to delete a project
  - `clearError`: Function to clear error state
- **Responsibilities**:
  - Fetching projects on mount
  - Creating new projects
  - Deleting projects
  - Navigation to project pages
  - Error handling

### `useProjectDeletion`

- **Purpose**: Manages the state for project deletion dialog and operations
- **Returns**:
  - `deleteDialogOpen`: Boolean for dialog visibility
  - `projectToDelete`: Project object to be deleted
  - `deletingProjectId`: ID of project currently being deleted
  - `openDeleteDialog`: Function to open dialog with project
  - `closeDeleteDialog`: Function to close dialog and reset state
  - `setDeleting`: Function to set deleting state
- **Responsibilities**:
  - Managing delete dialog state
  - Tracking which project is being deleted
  - Providing clean API for delete operations

### `useProjectFilter`

- **Purpose**: Manages project filtering, searching, and pagination
- **Parameters**:
  - `projects`: Array of projects to filter
- **Returns**:
  - `searchFilter`: Current search string
  - `setSearchFilter`: Function to update search
  - `showAll`: Boolean for showing all vs paginated results
  - `setShowAll`: Function to toggle show all
  - `filteredProjects`: Projects after applying search filter
  - `displayedProjects`: Projects to display (with pagination)
  - `hasMoreProjects`: Boolean indicating if more projects exist
  - `remainingCount`: Number of projects not shown
- **Responsibilities**:
  - Filtering projects by search term
  - Managing pagination state
  - Calculating display logic

## Benefits of This Hook Structure

1. **Separation of Concerns**: Each hook handles a specific aspect of functionality
2. **Reusability**: Hooks can be used in other components if needed
3. **Testability**: Business logic is isolated and can be unit tested
4. **Clean Components**: Components focus on UI while hooks handle logic
5. **Performance**: Proper memoization and optimization in hooks
6. **Type Safety**: All hooks are fully typed with TypeScript

## Usage Example

```tsx
import {
  useProjects,
  useProjectDeletion,
  useProjectFilter,
  useUserIdentity,
} from "../hooks";

const MyComponent = () => {
  const userIdentity = useUserIdentity();
  const { projects, createProject, deleteProject } = useProjects();
  const { openDeleteDialog, closeDeleteDialog } = useProjectDeletion();
  const { filteredProjects, setSearchFilter } = useProjectFilter(projects);

  // Check if user has admin role in current org
  const isAdmin = userIdentity?.currentOrgRole === "OWNER";

  // Use current org ID for API calls
  const currentOrgId = userIdentity?.currentOrgId;

  // Component logic here
};
```
