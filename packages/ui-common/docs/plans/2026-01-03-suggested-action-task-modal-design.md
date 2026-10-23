# Suggested Action Task Modal Design

## Overview

Convert the inline suggested action workflow to use a modal dialog, integrating with the ModalSystem for better separation of concerns and consistent modal management.

## Current State

- Suggested actions render as buttons via `SecondaryActionButtons`
- Clicking a button shows inline `SuggestedActionFollowUp` component
- Local state management in `ConversationMessage.tsx`
- Separate rendering logic from other secondary actions

## Goals

- Use modal dialog instead of inline component
- Integrate with centralized ModalSystem
- Consolidate all secondary action handling in `SecondaryActionRenderer`
- Simplify `ConversationMessage.tsx` by removing suggested action-specific logic

## Architecture

### Component Structure

**New Component:** `ui-common/src/components/Modals/SuggestedActionTaskModal.tsx`

Combines:
- NewTaskModal's dialog structure and task fields (name, description, priority)
- SuggestedActionFollowUp's workflow selectors (initiative, parent task)

**Props:**
```typescript
interface SuggestedActionTaskModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: SuggestedActionTaskData) => void;
  isLoading?: boolean;
  organizationId: string;
  projectId: string;
  conversationId?: string;
  actionLabel: string;
}

interface SuggestedActionTaskData {
  name: string;
  description?: string;
  priority: TaskPriority;
  initiativeId: string;
  parentTaskId?: string;
  nextAction: SuggestedActionNextAction;
}
```

### Modal Fields

**Section 1: Task Details**
- Task name (TextField, required, autofocus, 3-100 chars)
- Description (TextField, multiline, optional, max 500 chars)
- Priority (Select dropdown, defaults to Medium)

**Section 2: Task Organization**
- Initiative selector (required, uses InitiativeSelector)
- Parent task selector (optional, uses TaskSelector, filtered by initiative)

**Validation:**
- Submit disabled if: name invalid OR initiative not selected OR isLoading
- Name: 3-100 characters
- Description: max 500 characters

### ModalSystem Integration

**1. Add Modal Type** (`ui-common/src/contexts/types/modalTypes.ts`):
```typescript
export enum ModalType {
  ADVANCED_SEARCH = 'advanced_search',
  SUGGESTED_ACTION_TASK = 'suggested_action_task',
}

export interface SuggestedActionTaskModalConfig {
  type: ModalType.SUGGESTED_ACTION_TASK;
  organizationId: string;
  projectId: string;
  conversationId?: string;
  actionLabel: string;
  nextAction: SuggestedActionNextAction;
  onSubmit: (data: SuggestedActionTaskData) => void;
}

export type ModalConfig =
  | AdvancedSearchModalConfig
  | SuggestedActionTaskModalConfig;
```

**2. Add Service Method** (`ui-common/src/contexts/ModalService.tsx`):
```typescript
export interface ModalService {
  showAdvancedSearch: (...) => void;
  showSuggestedActionTask: (
    options: Omit<SuggestedActionTaskModalConfig, 'type' | 'organizationId'>
  ) => void;
  close: () => void;
}
```

**3. Update Modal Renderer** (`ui/src/components/HeyHeyModal.tsx`):
```typescript
case ModalType.SUGGESTED_ACTION_TASK:
  return (
    <Dialog open onClose={closeModal} maxWidth="sm" fullWidth>
      <SuggestedActionTaskModal
        open
        onClose={closeModal}
        organizationId={currentModal.organizationId}
        projectId={currentModal.projectId}
        conversationId={currentModal.conversationId}
        actionLabel={currentModal.actionLabel}
        onSubmit={currentModal.onSubmit}
      />
    </Dialog>
  );
```

### SecondaryActionRenderer Integration

**Update** `ui-common/src/components/Conversation/SecondaryActionRenderer.tsx`:

Replace the current `null` return for `suggested_action` with:

```typescript
if (handler === SecondaryActionHandler.SuggestedAction) {
  const modalService = useModalService();

  if (!isSuggestedActionPayload(action.payload)) {
    log.warn("ui", "Invalid payload for suggested_action handler", {
      actionId: action.id,
      handler,
      payload: action.payload,
    });
    return null;
  }

  const handleClick = () => {
    if (!modalService || !action.fieldId) return;

    modalService.showSuggestedActionTask({
      projectId: context.projectId,
      conversationId: context.conversationId,
      actionLabel: action.label,
      nextAction: action.payload.nextAction || SuggestedActionNextAction.GenerateTask,
      onSubmit: (data) => {
        handleNext({
          [action.fieldId!]: {
            type: SuggestedActionUserMessageTypeEnum.SuggestedActions,
            nextAction: data.nextAction,
            initiativeId: data.initiativeId,
            parentTaskId: data.parentTaskId,
            taskData: {
              name: data.name,
              description: data.description,
              priority: data.priority,
            },
          },
        }, messageId);
      },
    });
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Button variant="outlined" onClick={handleClick}>
        {action.label}
      </Button>
    </Box>
  );
}
```

Add type guard:
```typescript
const isSuggestedActionPayload = (
  payload: unknown
): payload is SuggestedActionPayload => {
  return (
    payload !== null &&
    payload !== undefined &&
    typeof payload === "object" &&
    "handlerType" in payload &&
    (payload as { handlerType: unknown }).handlerType === "suggested_action" &&
    "suggestedAction" in payload &&
    typeof (payload as { suggestedAction: unknown }).suggestedAction === "string"
  );
};
```

### ConversationMessage Cleanup

**Remove from** `ui-common/src/components/Conversation/Components/ConversationMessage.tsx`:

1. State management:
   - `suggestedActions` useMemo
   - `activeSuggestedActionId` state
   - `activeSuggestedAction` useMemo
   - `activeSuggestedActionPayload` useMemo
   - `activeSuggestedActionText` useMemo

2. Event handlers:
   - `handleSuggestedActionClick`
   - `handleSuggestedActionCancel`
   - `handleSuggestedActionCreate`

3. Rendering:
   - `SecondaryActionButtons` component and logic
   - `SuggestedActionFollowUp` component and logic

4. Imports:
   - `SecondaryActionButtons`
   - `SuggestedActionFollowUp`
   - `SuggestedActionUserMessageData`
   - `SuggestedActionPayload`
   - `SuggestedActionNextAction`
   - `isSuggestedActionPayload` type guard

**Result:** All secondary actions (including suggested actions) are handled uniformly through `DynamicForm` → `SecondaryActionRenderer`.

## Data Flow

```
User clicks "Generate Task" button
    ↓
SecondaryActionRenderer.handleClick()
    ↓
modalService.showSuggestedActionTask()
    ↓
ModalContext.openModal() sets currentModal state
    ↓
HeyHeyModal detects state change and renders SuggestedActionTaskModal
    ↓
User fills form and submits
    ↓
Modal calls onSubmit callback with task data
    ↓
SecondaryActionRenderer formats as SuggestedActionUserMessageData
    ↓
Calls handleNext() to continue conversation workflow
    ↓
Modal closes automatically
```

## Benefits

1. **Centralized modal management** - Uses ModalSystem for consistent behavior
2. **No prop drilling** - ModalService eliminates passing callbacks through layers
3. **Unified secondary actions** - All handlers in one place (SecondaryActionRenderer)
4. **Simpler components** - ConversationMessage no longer manages suggested action state
5. **Better UX** - Modal provides focused experience vs inline component
6. **Type safety** - ModalSystem discriminated union ensures compile-time checking
7. **Auto-injection** - ModalService injects organizationId automatically

## Files Modified

### ui-common
- `src/components/Modals/SuggestedActionTaskModal.tsx` (new)
- `src/contexts/types/modalTypes.ts` (add modal type and config)
- `src/contexts/ModalService.tsx` (add service method)
- `src/components/Conversation/SecondaryActionRenderer.tsx` (handle suggested_action)
- `src/components/Conversation/Components/ConversationMessage.tsx` (cleanup)

### ui
- `src/components/HeyHeyModal.tsx` (add modal renderer case)

## Migration Notes

- `SuggestedActionFollowUp` component becomes obsolete (can be deprecated)
- `SecondaryActionButtons` may still be used for other action types
- Existing conversation flow and data structures unchanged
- No backend changes required
