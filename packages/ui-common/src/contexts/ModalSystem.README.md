# Modal System

A type-safe, flexible modal management system for React applications with four-layer architecture.

## Architecture

The modal system has four distinct layers that provide separation of concerns:

1. **ModalContext** (state management) - Stores the currently open modal configuration
2. **ModalService** (convenience API) - Provides strongly-typed methods for opening modals
3. **Shared Inner Components** (ui-common) - Reusable modal content components (AdvancedSearch, EntityForm, etc.)
4. **Modal Renderer** (application-specific) - Wraps shared components with app-specific modal containers

> **Important**: The goal of this architecture is to allow any consumer to implement "modals" in their own way (Dialog, Drawer, inline, full-screen) while optionally reusing shared UI components from ui-common. Both the web app and VSCode extension can use the same inner components (like AdvancedSearch) but wrap them differently based on their environment.

```
┌─────────────────────────────────────────────────────────┐
│ Component calls:                                        │
│ modalService.showAdvancedSearch({ options })            │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ ModalService (ui-common)                                │
│ - Auto-injects organizationId                           │
│ - Calls openModal() with typed config                   │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ ModalContext (ui-common)                                │
│ - Stores currentModal state                             │
│ - Provides openModal() and closeModal()                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Modal Renderer (application-specific)                   │
│                                                          │
│ Web App (HeyHeyModal):          VSCode Extension:       │
│   <Dialog>                        <div>                 │
│     <AdvancedSearch />              <AdvancedSearch />  │
│   </Dialog>                       </div>                │
│                                                          │
│ - Reads currentModal from context                       │
│ - Chooses wrapper strategy (Dialog, inline, etc.)       │
│ - Renders shared component from ui-common               │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Shared Inner Components (ui-common)                     │
│                                                          │
│ - AdvancedSearch: Search interface with filters         │
│ - EntityForm: Create/edit entity forms (planned)        │
│ - ConfirmationDialog: Yes/no confirmations (planned)    │
│                                                          │
│ These are environment-agnostic and reusable across      │
│ web app, VSCode extension, mobile app, etc.             │
└─────────────────────────────────────────────────────────┘
```

## Installation & Setup

### Step 1: Wrap Your Application with ModalProvider

In your application root (e.g., `App.tsx`):

```typescript
import { ModalProvider } from "@hey-hey/ui-common/context";
import { HeyHeyModal } from "./components/HeyHeyModal";

function App() {
  return (
    <ModalProvider>
      {/* Your app components */}
      <YourComponents />

      {/* Modal renderer - renders modals based on ModalContext state */}
      <HeyHeyModal />
    </ModalProvider>
  );
}
```

### Step 2: Create a Modal Renderer Component

Create a component that renders modals based on the discriminated union type:

```typescript
// src/components/HeyHeyModal.tsx
import { AdvancedSearch } from "@hey-hey/ui-common/components";
import { useModal, ModalType } from "@hey-hey/ui-common/context";
import { Dialog } from "@mui/material";

export function HeyHeyModal(): React.ReactElement | null {
  const modalContext = useModal();

  if (!modalContext) {
    return null;
  }

  const { currentModal, closeModal } = modalContext;

  if (!currentModal) {
    return null;
  }

  switch (currentModal.type) {
    case ModalType.ADVANCED_SEARCH:
      return (
        <Dialog
          open
          onClose={closeModal}
          maxWidth="lg"
          fullWidth
          slotProps={{
            paper: {
              sx: { height: "80vh" },
            },
          }}
        >
          <AdvancedSearch
            organizationId={currentModal.organizationId}
            projectId={currentModal.projectId}
            defaultEntityTypes={currentModal.defaultEntityTypes}
            defaultStatuses={currentModal.defaultStatuses}
            allowMultiSelect={currentModal.allowMultiSelect}
            maxResults={currentModal.maxResults}
            onSelect={currentModal.onSelect}
            onClose={closeModal}
          />
        </Dialog>
      );

    case ModalType.CONFIRMATION:
      // TODO: Implement confirmation modal
      return null;

    case ModalType.ENTITY_LIST:
      // TODO: Implement entity list modal
      return null;

    case ModalType.ENTITY_DETAIL:
      // TODO: Implement entity detail modal
      return null;

    case ModalType.FORM:
      // TODO: Implement form modal
      return null;

    default:
      console.warn("HeyHeyModal: Unknown modal type", currentModal);
      return null;
  }
}
```

### Step 3: Use ModalService from Any Component

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

  return (
    <button onClick={handleOpenSearch} disabled={!modalService}>
      Open Advanced Search
    </button>
  );
}
```

## How It Works

1. **App Setup**: Wrap your application with `ModalProvider` from ui-common
2. **Modal Renderer**: Create a modal renderer component (e.g., `HeyHeyModal`) that reads `currentModal` from `useModal()` and renders based on `ModalType`
3. **Service Access**: Components use `useModalService()` hook to access the modal service
4. **Open Modal**: Component calls a method like `modalService.showAdvancedSearch({ options })`
5. **Context Updates**: ModalService calls `openModal()` which sets `currentModal` state in ModalContext
6. **Modal Renders**: The modal renderer component detects the state change and renders the appropriate modal
7. **User Interaction**: User interacts with the modal (selects, cancels, etc.)
8. **Callback Invoked**: Modal calls the appropriate callback from the modal configuration
9. **Modal Closes**: Component calls `closeModal()` which clears `currentModal` state

## Alternative: Inline Rendering

For environments where you want to render modals inline (e.g., VSCode extensions) instead of in a Dialog, you can still use the same modal system:

```typescript
import { useModal, ModalType } from "@hey-hey/ui-common/context";
import { AdvancedSearch } from "@hey-hey/ui-common/components";

function InlineModalRenderer(): React.ReactElement | null {
  const modalContext = useModal();

  if (!modalContext?.currentModal) {
    return null;
  }

  const { currentModal, closeModal } = modalContext;

  switch (currentModal.type) {
    case ModalType.ADVANCED_SEARCH:
      // Render inline instead of in a Dialog
      return (
        <AdvancedSearch
          organizationId={currentModal.organizationId}
          projectId={currentModal.projectId}
          defaultEntityTypes={currentModal.defaultEntityTypes}
          allowMultiSelect={currentModal.allowMultiSelect}
          onSelect={currentModal.onSelect}
          onClose={closeModal}
        />
      );

    default:
      return null;
  }
}

function VSCodeEditor() {
  const modalContext = useModal();
  const showingModal = !!modalContext?.currentModal;

  return <>{showingModal ? <InlineModalRenderer /> : <YourMainContent />}</>;
}
```

The API for opening modals remains identical - components still use `useModalService().showAdvancedSearch()`. Only the rendering strategy differs.

## Graceful Degradation

If you don't provide `ModalProvider`, modal service methods will be unavailable. Components that use `useModalService()` should check for `null`:

```typescript
const modalService = useModalService();

// Button will be disabled when modalService is null
<button onClick={handleOpenModal} disabled={!modalService}>
  Open Modal
</button>;
```

This is useful for environments where certain modals are not supported.

## Available Modal Types

The modal system supports the following modal types (defined in `ModalType` enum):

### ADVANCED_SEARCH

Full-featured search interface with filtering, entity preview, and selection.

```typescript
modalService.showAdvancedSearch({
  projectId?: string;
  defaultEntityTypes?: string[];
  defaultStatuses?: string[];
  allowMultiSelect?: boolean;
  maxResults?: number;
  onSelect: (entities: SearchEntity[]) => void;
});
```

See [AdvancedSearch README](../components/AdvancedSearch/README.md) for detailed documentation.

### CONFIRMATION (planned)

Simple confirmation dialog with title, message, and confirm/cancel actions.

### ENTITY_LIST (planned)

List view for browsing and selecting entities.

### ENTITY_DETAIL (planned)

Detail view for displaying full entity information.

### FORM (planned)

Generic form modal for creating/editing entities.

## Adding New Modal Types

To add a new modal type to the system:

### 1. Update the ModalType Enum

Add your new type to `/Users/zac/Desktop/code/hey-hey/ui-common/src/contexts/types/modalTypes.ts`:

```typescript
export enum ModalType {
  ADVANCED_SEARCH = "advanced_search",
  CONFIRMATION = "confirmation",
  MY_NEW_MODAL = "my_new_modal", // Add here
}
```

### 2. Create a Config Interface

Define the configuration interface for your modal:

```typescript
export interface MyNewModalConfig {
  type: ModalType.MY_NEW_MODAL;
  organizationId: string;
  // Add modal-specific options
  title: string;
  data: MyDataType;
  onSubmit: (result: MyResultType) => void;
}
```

### 3. Add to ModalConfig Union

Add your config to the discriminated union:

```typescript
export type ModalConfig =
  | AdvancedSearchModalConfig
  | ConfirmationModalConfig
  | MyNewModalConfig; // Add here
```

### 4. Add ModalService Method

Add a convenience method to `ModalService.tsx`:

```typescript
export interface ModalService {
  showAdvancedSearch: (...) => void;
  showMyNewModal: (
    options: Omit<MyNewModalConfig, 'type' | 'organizationId'>
  ) => void; // Add here
  close: () => void;
}

export function useModalService(): ModalService | null {
  // ...

  return {
    showAdvancedSearch: (...) => { ... },
    showMyNewModal: (options) => {
      if (!currentOrganization) {
        console.warn('Cannot open modal: no current organization');
        return;
      }

      modalContext.openModal({
        type: ModalType.MY_NEW_MODAL,
        organizationId: currentOrganization.id,
        ...options,
      });
    },
    close: () => modalContext.closeModal(),
  };
}
```

### 5. Update Modal Renderer

Add a case to your application's modal renderer component:

```typescript
export function HeyHeyModal(): React.ReactElement | null {
  const { currentModal, closeModal } = useModal();

  if (!currentModal) return null;

  switch (currentModal.type) {
    case ModalType.ADVANCED_SEARCH:
    // ...

    case ModalType.MY_NEW_MODAL:
      return (
        <Dialog open onClose={closeModal}>
          <MyNewModalComponent
            title={currentModal.title}
            data={currentModal.data}
            onSubmit={currentModal.onSubmit}
            onClose={closeModal}
          />
        </Dialog>
      );

    default:
      return null;
  }
}
```

### 6. Use in Components

```typescript
function MyComponent() {
  const modalService = useModalService();

  const handleOpenModal = () => {
    if (!modalService) return;

    modalService.showMyNewModal({
      title: "My Modal Title",
      data: myData,
      onSubmit: (result) => {
        console.log("Submitted:", result);
      },
    });
  };

  return <button onClick={handleOpenModal}>Open My Modal</button>;
}
```

## Benefits

### No Prop Drilling

No need to pass callbacks through multiple component layers. Components can open modals directly using the service.

### Separation of Concerns

- **ui-common**: Defines modal types, context, and service API
- **UI app**: Controls visual appearance and rendering strategy
- **Components**: Only need to know how to request modals, not how they're rendered

### Type Safety

Discriminated union ensures compile-time type checking for modal configurations. TypeScript catches missing required options.

### Auto-Injection

ModalService automatically injects `organizationId` from OrganizationContext. Callers don't need to worry about context dependencies.

### Single Source of Truth

ModalContext stores one active modal configuration. Only ONE modal can be open at a time, preventing modal stacking issues.

### Flexibility

Different applications can implement different rendering strategies:

- Web app: Material-UI Dialog
- VSCode extension: Inline rendering
- Mobile app: Bottom sheet or full-screen modal

### Graceful Degradation

Works without ModalProvider - buttons automatically disable when service is unavailable.

### Extensible

Easy to add new modal types by extending the discriminated union and adding a service method.

## Examples

### Complete Example with State Management

```typescript
import { useState } from "react";
import { Box, Button } from "@mui/material";
import { useModalService } from "@hey-hey/ui-common/context";
import type { SearchEntity } from "@hey-hey/ui-common";

function EntitySelector() {
  const modalService = useModalService();
  const [selectedEntities, setSelectedEntities] = useState<SearchEntity[]>([]);

  const handleOpenSearch = () => {
    if (!modalService) return;

    modalService.showAdvancedSearch({
      projectId: "proj-456",
      defaultEntityTypes: ["task", "initiative"],
      defaultStatuses: ["active", "in_progress"],
      allowMultiSelect: true,
      maxResults: 100,
      onSelect: (entities: SearchEntity[]) => {
        setSelectedEntities(entities);
        // Modal closes automatically
      },
    });
  };

  return (
    <Box>
      <Button onClick={handleOpenSearch} disabled={!modalService}>
        Select Entities
      </Button>

      {selectedEntities.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <h3>Selected Entities:</h3>
          {selectedEntities.map((entity) => (
            <div key={entity.id}>
              {entity.name} ({entity.type})
            </div>
          ))}
        </Box>
      )}
    </Box>
  );
}
```

### Custom Rendering Strategy

```typescript
import { useModal, ModalType } from "@hey-hey/ui-common/context";
import { Drawer } from "@mui/material";

// Custom renderer using Drawer instead of Dialog
export function DrawerModalRenderer(): React.ReactElement | null {
  const { currentModal, closeModal } = useModal();

  if (!currentModal) return null;

  switch (currentModal.type) {
    case ModalType.ADVANCED_SEARCH:
      return (
        <Drawer
          anchor="right"
          open
          onClose={closeModal}
          PaperProps={{ sx: { width: "60vw" } }}
        >
          <AdvancedSearch
            organizationId={currentModal.organizationId}
            // ... other props
            onClose={closeModal}
          />
        </Drawer>
      );

    default:
      return null;
  }
}
```

## API Reference

### ModalContext

**Location**: `/Users/zac/Desktop/code/hey-hey/ui-common/src/contexts/ModalContext.tsx`

```typescript
interface ModalContextValue {
  currentModal: ModalConfig | null;
  openModal: (config: ModalConfig) => void;
  closeModal: () => void;
}

const useModal = (): ModalContextValue | null;
```

### ModalService

**Location**: `/Users/zac/Desktop/code/hey-hey/ui-common/src/contexts/ModalService.tsx`

```typescript
interface ModalService {
  showAdvancedSearch: (
    options: Omit<AdvancedSearchModalConfig, 'type' | 'organizationId'>
  ) => void;
  close: () => void;
}

const useModalService = (): ModalService | null;
```

### ModalConfig Types

**Location**: `/Users/zac/Desktop/code/hey-hey/ui-common/src/contexts/types/modalTypes.ts`

See the types file for the complete discriminated union definition.

## Related Documentation

- [AdvancedSearch Component](../components/AdvancedSearch/README.md) - Detailed documentation for the AdvancedSearch modal
- [OrganizationContext](./OrganizationContext.tsx) - Organization context used by ModalService for auto-injection
