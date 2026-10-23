# Add New LLM Form Field

This command guides you through adding a new field component to the DynamicForm system.

## Required Information

Before starting, gather the following from the user:

1. **ExtendedUIFieldType** - The enum value (e.g., `task_priority`, `task_stub`)
2. **SystemMessageData type** - The API type for incoming data (e.g., `TaskPrioritySystemMessageData`)
3. **UI Description** - What the field should display and how it should look
4. **User Response Type** - What data the field sends back (e.g., just a message, selections, etc.)

## Files to Modify

### 1. Create the Field Component

Create `src/components/LlmForms/Registry/{FieldName}Field.tsx`

Follow this pattern:

```typescript
import React, { useState, useEffect } from "react";
import { Box, TextField, Typography } from "@mui/material";
import type { FieldComponentProps } from "./types";
import type { {SystemMessageDataType} } from "src/api/api";
import { isObject } from "lodash";

// User response type - what gets sent back
export interface {FieldName}UserMessage {
  userMessage: string;
  // Add other fields as needed
}

// Props interface
export interface {FieldName}FieldProps
  extends Omit<
    FieldComponentProps<{SystemMessageDataType} | {FieldName}UserMessage>,
    "onChange"
  > {
  value?: {SystemMessageDataType} | {FieldName}UserMessage;
  onChange?: (value: {FieldName}UserMessage) => void;
}

// Type guard for system message data
const is{SystemMessageDataType} = (
  value: {SystemMessageDataType} | {FieldName}UserMessage | undefined
): value is {SystemMessageDataType} => {
  if (value && isObject(value)) {
    return "type" in value && /* add other distinguishing fields */;
  }
  return false;
};

export const {FieldName}Field: React.FC<{FieldName}FieldProps> = ({
  config,
  value,
  onChange,
  error,
  disabled = false,
  isSubmitted = false,
}) => {
  const systemData = is{SystemMessageDataType}(value) ? value : undefined;

  const [fieldValue, setFieldValue] = useState<{FieldName}UserMessage>({
    userMessage: "",
  });

  useEffect(() => {
    if (systemData && !fieldValue.userMessage) {
      const initialValue: {FieldName}UserMessage = { userMessage: "" };
      setFieldValue(initialValue);
      onChange?.(initialValue);
    }
  }, [systemData, fieldValue.userMessage, onChange]);

  if (!systemData) {
    return (
      <Box sx={{ p: 2, color: "error.main" }}>
        <Typography>Error: Invalid data</Typography>
      </Box>
    );
  }

  const handleFeedbackChange = (text: string) => {
    const newValue: {FieldName}UserMessage = { userMessage: text };
    setFieldValue(newValue);
    onChange?.(newValue);
  };

  // Submitted view
  if (isSubmitted) {
    return (
      <Box sx={{ mb: 2 }}>
        {/* Display submitted state */}
      </Box>
    );
  }

  // Active editing view
  return (
    <Box sx={{ mb: 2 }} data-testid={`{field-name}-field-${config.field}`}>
      {/* Display content and input controls */}
      <TextField
        multiline
        rows={4}
        fullWidth
        value={fieldValue.userMessage}
        onChange={(e) => handleFeedbackChange(e.target.value)}
        placeholder="Add feedback..."
        disabled={disabled}
        variant="outlined"
        label="Your Feedback (Optional)"
        data-testid="feedback-textarea"
      />
      {error && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
};
```

### 2. Register in Registry.tsx

Edit `src/components/LlmForms/Registry/Registry.tsx`:

```typescript
// Add import
import { {FieldName}Field } from "./{FieldName}Field";

// Add to FIELD_REGISTRY
{field_type}: {FieldName}Field as unknown as React.FC<FieldComponentProps>,
```

### 3. Add Type Mapping in utils.ts

Edit `src/components/LlmForms/utils.ts`:

```typescript
// Add to typeMapping object
{field_type}: "{field_type}",
{FIELD_TYPE}: "{field_type}", // uppercase version if needed
```

### 4. Add Zod Schema in DynamicForm.tsx

Edit `src/components/LlmForms/DynamicForm.tsx`:

Add a case in `generateSchemaFromUIElements`:

```typescript
case "{field_type}":
  fieldSchema = z.object({
    userMessage: z.string(),
    // Add other fields matching your UserMessage type
  });
  break;
```

## Checklist

- [ ] ExtendedUIFieldType exists in API (check `src/api/docs/ExtendedUIFieldType.md`)
- [ ] SystemMessageData type exists in API (check `src/api/api.ts`)
- [ ] Created `{FieldName}Field.tsx` component
- [ ] Added import and registration in `Registry.tsx`
- [ ] Added type mapping in `utils.ts`
- [ ] Added zod schema case in `DynamicForm.tsx`
- [ ] Run `pnpm run type-check` - must show 0 errors

## Reference Files

- Existing field example: `src/components/LlmForms/Registry/TaskStubField.tsx`
- Simpler field example: `src/components/LlmForms/Registry/TaskPriorityField.tsx`
- API types: `src/api/api.ts`
- Field types: `src/components/LlmForms/Registry/types.ts`
