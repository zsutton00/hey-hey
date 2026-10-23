# Integration Components

A modular suite of components for managing integrations in the LlmForms Registry.

## Directory Structure

```
Integration/
├── README.md                           # This file
├── index.ts                            # Barrel exports
├── types.ts                            # TypeScript type definitions
├── integrationRegistry.ts              # Available integrations registry
├── IntegrationSearch.tsx               # Search input component
├── AvailableIntegrationCard.tsx        # Card for available integrations
├── ConfiguredIntegrationsList.tsx      # List of configured integrations
├── IntegrationConfigDialog.tsx         # Configuration dialog
└── __tests__/                          # Test files
    ├── IntegrationsField.test.tsx       # Main field tests
    ├── IntegrationSearch.test.tsx       # Search component tests
    └── AvailableIntegrationCard.test.tsx # Card component tests
```

## Components

### IntegrationSearch

Search input component with search icon for filtering available integrations.

**Props:**

- `searchTerm: string` - Current search term
- `onSearchChange: (term: string) => void` - Search change handler
- `disabled?: boolean` - Whether the input is disabled

### AvailableIntegrationCard

Card component displaying an available integration with add functionality.

**Props:**

- `integration: AvailableIntegration` - Integration data
- `onAdd: (type: string) => void` - Handler for adding integration
- `disabled?: boolean` - Whether the card is disabled

### ConfiguredIntegrationsList

List component showing configured integrations with edit/delete actions.

**Props:**

- `integrations: Integration[]` - Array of configured integrations
- `onEdit: (integration: Integration) => void` - Edit handler
- `onDelete: (integrationId: string) => void` - Delete handler
- `disabled?: boolean` - Whether actions are disabled

### IntegrationConfigDialog

Modal dialog for configuring integration settings.

**Props:**

- `open: boolean` - Whether dialog is open
- `onClose: () => void` - Close handler
- `integration: AvailableIntegration | null` - Integration to configure
- `existingConfig?: Record<string, string>` - Existing configuration for editing
- `onSave: (config: Record<string, string>) => void` - Save handler
- `isEditing?: boolean` - Whether in edit mode

## Types

### Integration

Represents a configured integration instance.

```typescript
interface Integration {
  id: string;
  type: string;
  name: string;
  config: Record<string, any>;
  isConfigured: boolean;
  createdAt: string;
}
```

### AvailableIntegration

Represents an integration type that can be configured.

```typescript
interface AvailableIntegration {
  type: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  configFields: IntegrationConfigField[];
}
```

### IntegrationConfigField

Represents a configuration field for an integration.

```typescript
interface IntegrationConfigField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  description?: string;
}
```

## Adding New Integrations

To add a new integration type, update the `AVAILABLE_INTEGRATIONS` array in `integrationRegistry.ts`:

```typescript
{
  type: "slack",
  name: "Slack",
  description: "Connect to Slack for notifications",
  icon: <SlackIcon />,
  configFields: [
    {
      key: "webhook",
      label: "Webhook URL",
      type: "url",
      required: true,
      placeholder: "https://hooks.slack.com/...",
      description: "Slack webhook URL for sending messages"
    }
  ]
}
```

## Testing

Each component has its own test file covering:

- Rendering
- User interactions
- Props validation
- Accessibility

Run tests with:

```bash
pnpm test Integration
```

## Architecture Benefits

1. **Modularity**: Each component has a single responsibility
2. **Reusability**: Components can be used independently
3. **Testability**: Small, focused components are easier to test
4. **Maintainability**: Changes to one component don't affect others
5. **Extensibility**: Easy to add new integration types or modify existing ones
