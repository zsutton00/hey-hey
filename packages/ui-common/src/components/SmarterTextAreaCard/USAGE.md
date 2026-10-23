# SmarterTextAreaCard Usage Guide

## Overview

`SmarterTextAreaCard` is a Lexical-based text area component that supports @mentioning other entities (tasks, initiatives, etc.) with automatic serialization to `@[type:id|name]` format.

## Basic Usage

```tsx
import { useState } from "react";
import { SmarterTextAreaCard } from "@/components";
import { useEntitySearch } from "@/data/hooks/useEntitySearch";

export const MyComponent = ({ organizationId }: { organizationId: string }) => {
  const [content, setContent] = useState("");
  const { searchEntities } = useEntitySearch(organizationId);

  return (
    <SmarterTextAreaCard
      value={content}
      onChange={setContent}
      saveStatus="draft"
      saveMode={null}
      hasUnsavedChanges={content.length > 0}
      onSearchEntities={searchEntities}
      headerText="Add your notes here"
      placeholder="Type @ to mention entities..."
      onSaveWithoutFeedback={() => {
        // Handle save
        console.log("Saving:", content);
      }}
    />
  );
};
```

## Mention Format

Mentions are serialized to a special format: `@[type:id|name]`

### Examples

- `@[task:abc-123|Build login page]`
- `@[initiative:xyz-789|Q4 Goals]`
- `@[design-doc:def-456|Architecture Document]`

### Content with Multiple Mentions

```
Check out @[task:abc-123|Build login page] and @[initiative:xyz-789|Q4 Goals]
for implementation details.
```

## Props

### Core Props (Required)

- `value: string` - Current text content (with serialized mentions)
- `onChange: (value: string) => void` - Called when content changes
- `saveStatus: SaveStatus` - Current save status ('draft', 'saving', 'saved', 'complete', etc.)
- `saveMode: SaveMode` - Current save mode ('silent', 'feedback', null)
- `hasUnsavedChanges: boolean` - Whether there are unsaved changes
- `onSearchEntities: (query: string, entityType: string) => Promise<SearchEntity[]>` - Search function

### Optional Props

- `onSaveWithoutFeedback?: () => void` - Callback for silent save
- `onSaveWithFeedback?: () => void` - Callback for feedback save
- `headerText?: string` - Header text (e.g., "Add your notes")
- `placeholder?: string` - Input placeholder
- `currentEntityType?: string` - Default entity type for mentions (e.g., "task")
- `mentionableEntityTypes?: string[]` - Available entity types for filtering
- `isSaving?: boolean` - Whether save is in progress
- `error?: boolean` - Error state
- `helperText?: string` - Helper/error text
- `disabled?: boolean` - Disable input
- `onFocus?: () => void` - Focus callback
- `onBlur?: () => void` - Blur callback

## Using with useEntitySearch Hook

```tsx
import { useEntitySearch } from "@/data/hooks/useEntitySearch";

export const TaskNotes = ({ taskId, organizationId }: Props) => {
  const { searchEntities } = useEntitySearch(organizationId);

  return (
    <SmarterTextAreaCard
      value={notes}
      onChange={setNotes}
      onSearchEntities={searchEntities}
      currentEntityType="task"
      mentionableEntityTypes={["task", "initiative"]}
      // ... other props
    />
  );
};
```

## Parsing Mentions on Backend

The serialized format `@[type:id|name]` can be parsed with this regex:

```typescript
const mentionRegex = /@\[([a-z-]+):([a-z0-9-]+)\|([^\]]+)\]/g;

const mentions = Array.from(content.matchAll(mentionRegex)).map((match) => ({
  entityType: match[1],
  entityId: match[2],
  entityName: match[3],
}));
```

Or use the built-in utility:

```tsx
import { deserializeContent } from "@/components/SmarterTextAreaCard";

const mentions = deserializeContent(content);
```

## Mention Interaction Flow

1. **User types @** → Mention mode activated
2. **User types query** → Search debounced with entities (150ms)
3. **Popup shows results** → Filtered by entity type selector
4. **User selects entity** → Mention node inserted as badge
5. **User continues typing** → Content serialized with mention token

## Styling & Theme

The component uses Material-UI theming:

- Mention badges rendered with `primary.main` color
- Hover state shows `primary.dark`
- Header and status area use theme-aware colors
- Actions buttons styled with `actionable` theme palette

## Testing

Key test IDs for component testing:

- `data-testid="smarter-textarea-card"` - Root container
- `data-testid="smarter-textarea-input"` - Text input area
- `data-testid="mention-badge"` - Rendered mention badge
- `data-testid="mention-popup"` - Search popup
- `data-testid="mention-result-row"` with `data-entity-id` - Individual search result

## Example: Complete Form Integration

```tsx
import { useState } from "react";
import { SmarterTextAreaCard } from "@/components";
import { useEntitySearch } from "@/data/hooks/useEntitySearch";
import { Box, Button } from "@mui/material";

export const IdeaForm = ({ organizationId }: { organizationId: string }) => {
  const [content, setContent] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("draft");
  const [isSaving, setIsSaving] = useState(false);
  const { searchEntities } = useEntitySearch(organizationId);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus("saving");
    try {
      // Extract mentions and send to API
      const mentions = deserializeContent(content);
      await submitIdea({ content, mentions });
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("draft");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Box>
      <SmarterTextAreaCard
        value={content}
        onChange={setContent}
        saveStatus={saveStatus}
        saveMode={null}
        hasUnsavedChanges={content.length > 0}
        isSaving={isSaving}
        onSearchEntities={searchEntities}
        onSaveWithoutFeedback={handleSave}
        headerText="Share your idea"
        placeholder="Type @ to reference related work..."
      />
    </Box>
  );
};
```

## Performance Notes

- Search is debounced to 150ms to avoid excessive API calls
- Mention nodes are immutable to prevent accidental corruption
- Entity list is virtualized for large result sets (built into MUI List)
- Type filtering happens client-side after API results

## Limitations

- Mentions cannot be edited once inserted (immutable)
- Maximum 10 results shown by default (configurable via hook)
- Entity names with `]` character will be truncated (regex limitation)
- Does not support nested mentions

## Future Enhancements

- [ ] Rich mention preview with entity details
- [ ] Keyboard shortcuts for mention selection (arrow keys)
- [ ] Recent mentions suggestions
- [ ] Mention @ name formatting options
