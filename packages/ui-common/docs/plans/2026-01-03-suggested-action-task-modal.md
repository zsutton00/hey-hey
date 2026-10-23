# Suggested Action Task Modal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert inline suggested action workflow to use modal dialog integrated with ModalSystem

**Architecture:** Create SuggestedActionTaskModal component combining task fields and workflow selectors, integrate with ModalSystem for centralized management, consolidate all secondary action handling in SecondaryActionRenderer

**Tech Stack:** React, TypeScript, Material-UI, ModalSystem (ui-common context)

---

## Task 1: Add Modal Type Configuration

**Files:**
- Modify: `/Users/zac/Desktop/code/hey-hey/ui-common/src/contexts/types/modalTypes.ts`

**Step 1: Add SUGGESTED_ACTION_TASK to ModalType enum**

Add after ADVANCED_SEARCH:

```typescript
export enum ModalType {
  ADVANCED_SEARCH = 'advanced_search',
  SUGGESTED_ACTION_TASK = 'suggested_action_task',
}
```

**Step 2: Add SuggestedActionTaskData interface**

Add before modal config interfaces:

```typescript
import type { SuggestedActionNextAction } from '../../api';

export interface SuggestedActionTaskData {
  name: string;
  description?: string;
  priority: TaskPriority;
  initiativeId: string;
  parentTaskId?: string;
  nextAction: SuggestedActionNextAction;
}
```

**Step 3: Add SuggestedActionTaskModalConfig interface**

Add after AdvancedSearchModalConfig:

```typescript
export interface SuggestedActionTaskModalConfig {
  type: ModalType.SUGGESTED_ACTION_TASK;
  organizationId: string;
  projectId: string;
  conversationId?: string;
  actionLabel: string;
  nextAction: SuggestedActionNextAction;
  onSubmit: (data: SuggestedActionTaskData) => void;
}
```

**Step 4: Add to ModalConfig union type**

Update the union:

```typescript
export type ModalConfig =
  | AdvancedSearchModalConfig
  | SuggestedActionTaskModalConfig;
```

**Step 5: Run type check**

Run: `pnpm run type-check`
Expected: No errors related to modalTypes.ts

**Step 6: Commit modal type configuration**

```bash
git add src/contexts/types/modalTypes.ts
git commit -m "feat: add SUGGESTED_ACTION_TASK modal type configuration"
```

---

## Task 2: Create SuggestedActionTaskModal Component

**Files:**
- Create: `/Users/zac/Desktop/code/hey-hey/ui-common/src/components/Modals/SuggestedActionTaskModal.tsx`
- Create: `/Users/zac/Desktop/code/hey-hey/ui-common/src/components/Modals/index.ts` (if doesn't exist)

**Step 1: Create the modal component file**

Create file with imports and interface:

```typescript
import React, { useState, useCallback } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../i18n/keys";
import type { TaskPriority } from "../../api";
import { Priority, SuggestedActionNextAction } from "../../api";
import { InitiativeSelector, TaskSelector } from "../Selectors";
import type { SuggestedActionTaskData } from "../../contexts/types/modalTypes";

interface FormErrors {
  name?: string;
  description?: string;
}

export interface SuggestedActionTaskModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: SuggestedActionTaskData) => void;
  isLoading?: boolean;
  organizationId: string;
  projectId: string;
  conversationId?: string;
  actionLabel: string;
  nextAction: SuggestedActionNextAction;
}
```

**Step 2: Add component implementation**

Add the component:

```typescript
export const SuggestedActionTaskModal: React.FC<SuggestedActionTaskModalProps> = ({
  open,
  onClose,
  onSubmit,
  isLoading = false,
  organizationId,
  projectId,
  conversationId,
  actionLabel,
  nextAction,
}) => {
  const { t } = useTranslation();

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    priority: Priority.Medium as TaskPriority,
    initiativeId: "",
    parentTaskId: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});

  // Form validation
  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.name?.trim()) {
      newErrors.name = t(KEYS.tasks.dialog.nameRequired);
    } else if (formData.name.trim().length < 3) {
      newErrors.name = t(KEYS.tasks.dialog.nameTooShort);
    } else if (formData.name.trim().length > 100) {
      newErrors.name = t(KEYS.tasks.dialog.nameTooLong);
    }

    if (formData.description && formData.description.trim().length > 500) {
      newErrors.description = t(KEYS.tasks.dialog.descriptionTooLong);
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, t]);

  // Event handlers
  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setFormData((prev) => ({ ...prev, name: value }));

      if (errors.name && value.trim()) {
        setErrors((prev) => ({ ...prev, name: undefined }));
      }
    },
    [errors.name]
  );

  const handleDescriptionChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setFormData((prev) => ({ ...prev, description: value }));

      if (errors.description && value.trim()) {
        setErrors((prev) => ({ ...prev, description: undefined }));
      }
    },
    [errors.description]
  );

  const handlePriorityChange = useCallback(
    (event: unknown) => {
      const changeEvent = event as React.ChangeEvent<{ value: unknown }>;
      const value = changeEvent.target.value as TaskPriority;
      setFormData((prev) => ({ ...prev, priority: value }));
    },
    []
  );

  const handleInitiativeChange = useCallback((initiativeId: string | null) => {
    setFormData((prev) => ({
      ...prev,
      initiativeId: initiativeId || "",
      parentTaskId: "", // Reset parent task when initiative changes
    }));
  }, []);

  const handleParentTaskChange = useCallback((taskId: string | null) => {
    setFormData((prev) => ({ ...prev, parentTaskId: taskId || "" }));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!validateForm() || !formData.initiativeId) {
      return;
    }

    const data: SuggestedActionTaskData = {
      name: formData.name.trim(),
      description: formData.description?.trim() || undefined,
      priority: formData.priority,
      initiativeId: formData.initiativeId,
      parentTaskId: formData.parentTaskId || undefined,
      nextAction,
    };

    onSubmit(data);
  }, [formData, validateForm, onSubmit, nextAction]);

  const handleClose = useCallback(() => {
    if (!isLoading) {
      setFormData({
        name: "",
        description: "",
        priority: Priority.Medium,
        initiativeId: "",
        parentTaskId: "",
      });
      setErrors({});
      onClose();
    }
  }, [isLoading, onClose]);

  const canSubmit = Boolean(
    formData.name.trim() &&
    formData.initiativeId &&
    !isLoading
  );

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="suggested-action-task-dialog-title"
    >
      <DialogTitle id="suggested-action-task-dialog-title">
        {actionLabel}
      </DialogTitle>

      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
          {/* Task Details Section */}
          <TextField
            fullWidth
            label={t(KEYS.tasks.form.title)}
            placeholder={t(KEYS.tasks.dialog.namePlaceholder)}
            value={formData.name}
            onChange={handleNameChange}
            error={!!errors.name}
            helperText={errors.name}
            autoFocus
            disabled={isLoading}
            inputProps={{
              maxLength: 100,
            }}
          />

          <TextField
            fullWidth
            label={t(KEYS.tasks.form.description)}
            placeholder={t(KEYS.tasks.dialog.descriptionPlaceholder)}
            value={formData.description}
            onChange={handleDescriptionChange}
            error={!!errors.description}
            helperText={errors.description}
            multiline
            rows={3}
            disabled={isLoading}
            inputProps={{
              maxLength: 500,
            }}
          />

          <FormControl fullWidth disabled={isLoading}>
            <InputLabel id="priority-select-label">
              {t(KEYS.tasks.form.priority)}
            </InputLabel>
            <Select
              labelId="priority-select-label"
              value={formData.priority}
              label={t(KEYS.tasks.form.priority)}
              onChange={handlePriorityChange}
            >
              <MenuItem value="LOW">{t(KEYS.tasks.priority.low)}</MenuItem>
              <MenuItem value="MEDIUM">{t(KEYS.tasks.priority.medium)}</MenuItem>
              <MenuItem value="HIGH">{t(KEYS.tasks.priority.high)}</MenuItem>
            </Select>
          </FormControl>

          {/* Task Organization Section */}
          <InitiativeSelector
            organizationId={organizationId}
            projectId={projectId}
            conversationId={conversationId}
            label={t(KEYS.conversation.suggestedAction.initiativeLabel)}
            placeholder={t(KEYS.conversation.suggestedAction.initiativePlaceholder)}
            value={formData.initiativeId || null}
            onChange={handleInitiativeChange}
          />

          <TaskSelector
            organizationId={organizationId}
            projectId={projectId}
            initiativeId={formData.initiativeId || undefined}
            label={t(KEYS.conversation.suggestedAction.parentTaskLabel)}
            placeholder={t(KEYS.conversation.suggestedAction.parentTaskPlaceholder)}
            value={formData.parentTaskId || null}
            onChange={handleParentTaskChange}
          />
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={isLoading}>
          {t(KEYS.common.cancel)}
        </Button>

        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!canSubmit}
          startIcon={isLoading ? <CircularProgress size={16} /> : undefined}
        >
          {isLoading ? t(KEYS.tasks.dialog.creating) : t(KEYS.common.create)}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
```

**Step 3: Create/update index.ts for exports**

```typescript
export { SuggestedActionTaskModal } from './SuggestedActionTaskModal';
export type { SuggestedActionTaskModalProps } from './SuggestedActionTaskModal';
```

**Step 4: Run type check**

Run: `pnpm run type-check`
Expected: No errors in SuggestedActionTaskModal.tsx

**Step 5: Commit modal component**

```bash
git add src/components/Modals/
git commit -m "feat: add SuggestedActionTaskModal component"
```

---

## Task 3: Add ModalService Method

**Files:**
- Modify: `/Users/zac/Desktop/code/hey-hey/ui-common/src/contexts/ModalService.tsx`

**Step 1: Add import for modal config type**

Add to imports at top:

```typescript
import type { SuggestedActionTaskModalConfig } from './types/modalTypes';
```

**Step 2: Add showSuggestedActionTask to ModalService interface**

Update interface:

```typescript
export interface ModalService {
  showAdvancedSearch: (
    options: Omit<AdvancedSearchModalConfig, 'type' | 'organizationId'>
  ) => void;
  showSuggestedActionTask: (
    options: Omit<SuggestedActionTaskModalConfig, 'type' | 'organizationId'>
  ) => void;
  close: () => void;
}
```

**Step 3: Implement showSuggestedActionTask method**

Add to the return object in useModalService:

```typescript
showSuggestedActionTask: (options) => {
  if (!currentOrganization) {
    console.warn('Cannot open modal: no current organization');
    return;
  }

  modalContext.openModal({
    type: ModalType.SUGGESTED_ACTION_TASK,
    organizationId: currentOrganization.id,
    ...options,
  });
},
```

**Step 4: Run type check**

Run: `pnpm run type-check`
Expected: No errors in ModalService.tsx

**Step 5: Commit modal service method**

```bash
git add src/contexts/ModalService.tsx
git commit -m "feat: add showSuggestedActionTask to ModalService"
```

---

## Task 4: Update SecondaryActionRenderer

**Files:**
- Modify: `/Users/zac/Desktop/code/hey-hey/ui-common/src/components/Conversation/SecondaryActionRenderer.tsx`

**Step 1: Add imports**

Add to imports:

```typescript
import { useModalService } from "../../contexts/ModalService";
import { SuggestedActionUserMessageTypeEnum } from "../../api";
import type { SuggestedActionPayload } from "../../api";
import { Button } from "@mui/material";
```

**Step 2: Add type guard for SuggestedActionPayload**

Add before the component:

```typescript
/**
 * Type guard to check if payload is SuggestedActionPayload
 */
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

**Step 3: Replace suggested_action handler implementation**

Replace the current `if (handler === SecondaryActionHandler.SuggestedAction)` block with:

```typescript
// Suggested Action - opens modal for task creation
if (handler === SecondaryActionHandler.SuggestedAction) {
  const modalService = useModalService();

  if (!isSuggestedActionPayload(action.payload)) {
    log.warn("ui", "Invalid payload for suggested_action handler", {
      actionId: action.id,
      handler,
      payload: action.payload,
    });
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        Invalid payload for suggested_action handler
      </Alert>
    );
  }

  const handleClick = () => {
    if (!modalService || !action.fieldId) {
      log.warn("ui", "Cannot open modal: missing modalService or fieldId", {
        actionId: action.id,
        hasModalService: !!modalService,
        hasFieldId: !!action.fieldId,
      });
      return;
    }

    modalService.showSuggestedActionTask({
      projectId: context.projectId,
      conversationId: context.conversationId,
      actionLabel: action.label,
      nextAction: action.payload.nextAction || SuggestedActionNextAction.GenerateTask,
      onSubmit: (data) => {
        handleNext(
          {
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
          },
          messageId
        );
      },
    });
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Button
        variant="outlined"
        onClick={handleClick}
        disabled={!modalService}
      >
        {action.label}
      </Button>
    </Box>
  );
}
```

**Step 4: Update component documentation**

The documentation comment already includes suggested_action - verify it says:
- `- suggested_action: Returns null (handled separately as buttons)`

Change to:
- `- suggested_action: Renders button that opens modal for task creation`

**Step 5: Run type check**

Run: `pnpm run type-check`
Expected: No errors in SecondaryActionRenderer.tsx

**Step 6: Commit renderer updates**

```bash
git add src/components/Conversation/SecondaryActionRenderer.tsx
git commit -m "feat: handle suggested_action in SecondaryActionRenderer with modal"
```

---

## Task 5: Update HeyHeyModal Renderer (ui app)

**Files:**
- Modify: `/Users/zac/Desktop/code/hey-hey/ui/src/components/HeyHeyModal.tsx`

**Step 1: Add import**

Add to imports:

```typescript
import { SuggestedActionTaskModal } from '@hey-hey/ui-common/components/Modals';
```

**Step 2: Add case to switch statement**

Add after ADVANCED_SEARCH case:

```typescript
case ModalType.SUGGESTED_ACTION_TASK:
  return (
    <Dialog
      open
      onClose={closeModal}
      maxWidth="sm"
      fullWidth
    >
      <SuggestedActionTaskModal
        open
        onClose={closeModal}
        organizationId={currentModal.organizationId}
        projectId={currentModal.projectId}
        conversationId={currentModal.conversationId}
        actionLabel={currentModal.actionLabel}
        nextAction={currentModal.nextAction}
        onSubmit={(data) => {
          currentModal.onSubmit(data);
          closeModal();
        }}
      />
    </Dialog>
  );
```

**Step 3: Run type check**

Run: `pnpm run type-check`
Expected: No errors in HeyHeyModal.tsx

**Step 4: Commit modal renderer**

```bash
git add src/components/HeyHeyModal.tsx
git commit -m "feat: add SUGGESTED_ACTION_TASK case to HeyHeyModal renderer"
```

---

## Task 6: Clean up ConversationMessage Component

**Files:**
- Modify: `/Users/zac/Desktop/code/hey-hey/ui-common/src/components/Conversation/Components/ConversationMessage.tsx`

**Step 1: Remove suggested action imports**

Remove these imports:

```typescript
import {
  SecondaryActionButtons,
  SuggestedActionFollowUp,
  type SuggestedActionUserMessageData,
} from "../SecondaryActions";
```

Remove from api imports:
```typescript
SuggestedActionNextAction,
type SuggestedActionPayload,
```

**Step 2: Remove suggested action state and memos**

Remove these lines (around lines 65-93):

```typescript
const suggestedActions = useMemo(
  () =>
    secondaryActions.filter(
      (action) =>
        action.handler === SecondaryActionHandler.SuggestedAction &&
        isSuggestedActionPayload(action.payload)
    ),
  [secondaryActions]
);
const [activeSuggestedActionId, setActiveSuggestedActionId] = useState<
  string | null
>(null);
const activeSuggestedAction = useMemo(
  () =>
    suggestedActions.find((action) => action.id === activeSuggestedActionId),
  [activeSuggestedActionId, suggestedActions]
);
const activeSuggestedActionPayload = useMemo(() => {
  if (!activeSuggestedAction) {
    return undefined;
  }
  return isSuggestedActionPayload(activeSuggestedAction.payload)
    ? activeSuggestedAction.payload
    : undefined;
}, [activeSuggestedAction]);
const activeSuggestedActionText = useMemo(
  () => activeSuggestedActionPayload?.suggestedAction,
  [activeSuggestedActionPayload]
);
```

**Step 3: Remove suggested action handlers**

Remove these callbacks (around lines 95-127):

```typescript
const handleSuggestedActionClick = useCallback(
  (action: SecondaryActionConfig) => {
    if (action.handler !== SecondaryActionHandler.SuggestedAction) {
      return;
    }
    setActiveSuggestedActionId(action.id);
  },
  []
);

const handleSuggestedActionCancel = useCallback(() => {
  setActiveSuggestedActionId(null);
}, []);

const handleSuggestedActionCreate = useCallback(
  async (
    action: SecondaryActionConfig,
    payload: SuggestedActionUserMessageData
  ) => {
    if (!action.fieldId) {
      return;
    }

    await handleNext(
      {
        [action.fieldId]: payload,
      },
      conversationMessage.message.id
    );
    setActiveSuggestedActionId(null);
  },
  [conversationMessage.message.id, handleNext]
);
```

**Step 4: Remove suggested action rendering**

Remove this JSX (around lines 149-173):

```typescript
{suggestedActions.length > 0 && (
  <SecondaryActionButtons
    actions={suggestedActions}
    onActionClick={handleSuggestedActionClick}
  />
)}

{activeSuggestedAction && activeSuggestedActionText && (
  <SuggestedActionFollowUp
    actionLabel={activeSuggestedAction.label}
    suggestedActionText={activeSuggestedActionText}
    organizationId={project.organizationId}
    projectId={project.id}
    conversationId={activeConversation.id}
    nextAction={
      activeSuggestedActionPayload?.nextAction ||
      SuggestedActionNextAction.GenerateTask
    }
    onCancel={handleSuggestedActionCancel}
    onCreate={(payload) =>
      handleSuggestedActionCreate(activeSuggestedAction, payload)
    }
  />
)}
```

**Step 5: Remove type guard at bottom of file**

Remove the `isSuggestedActionPayload` function (around lines 203-215):

```typescript
const isSuggestedActionPayload = (
  payload: unknown
): payload is SuggestedActionPayload => {
  return (
    payload !== null &&
    payload !== undefined &&
    typeof payload === "object" &&
    "handlerType" in payload &&
    (payload as { handlerType?: string }).handlerType === "suggested_action" &&
    "suggestedAction" in payload &&
    typeof (payload as { suggestedAction?: unknown }).suggestedAction ===
      "string"
  );
};
```

**Step 6: Run type check**

Run: `pnpm run type-check`
Expected: No errors in ConversationMessage.tsx

**Step 7: Commit cleanup**

```bash
git add src/components/Conversation/Components/ConversationMessage.tsx
git commit -m "refactor: remove suggested action logic from ConversationMessage"
```

---

## Task 7: Final Type Check and Verification

**Files:**
- All modified files

**Step 1: Run full type check**

Run: `pnpm run type-check`
Expected: Found 0 errors

**Step 2: Verify all changes committed**

Run: `git status`
Expected: Working tree clean or only untracked files

**Step 3: Review commit log**

Run: `git log --oneline -7`
Expected: See all 7 commits from this implementation

---

## Testing Notes

Manual testing required:
1. Navigate to a conversation with suggested actions
2. Verify "Generate Task" button appears
3. Click button and verify modal opens
4. Fill out form (name, initiative required)
5. Verify submit disabled until required fields filled
6. Submit and verify conversation continues
7. Verify modal closes after submission

---

## Success Criteria

- [ ] Type check passes with 0 errors
- [ ] Modal opens when clicking suggested action button
- [ ] Form validation works (required fields, character limits)
- [ ] Initiative selector filters parent task selector
- [ ] Submit creates task and continues conversation
- [ ] Modal closes after successful submission
- [ ] No suggested action logic remains in ConversationMessage
- [ ] All secondary actions handled in SecondaryActionRenderer
