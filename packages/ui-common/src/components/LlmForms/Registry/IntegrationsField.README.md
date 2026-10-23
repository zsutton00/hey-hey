# IntegrationsField Component

A comprehensive form field component for managing integrations in the LlmForms Registry.

## Features

- **Fuzzy Search**: Search through available integrations by name or description
- **Dynamic Setup Flows**: Each integration type has its own configuration flow
- **Existing Integrations Management**: View, edit, and delete configured integrations
- **Validation**: Form validation for required configuration fields
- **Status Management**: Visual indicators for active/inactive integrations

## Usage

```typescript
import { DynamicForm } from '../LlmForms/DynamicForm'

const config = {
  questions: [
    {
      field: 'integrations',
      description: 'Configure your integrations',
      type: 'integrations',
      required: false
    }
  ]
}

<DynamicForm
  config={config}
  onNext={(data) => console.log(data.integrations)}
  // ... other props
/>
```

## Available Integrations

### GitHub

- **Description**: Connect your GitHub repositories for issue tracking and code management
- **Configuration**:
  - Personal Access Token (required)
  - Organization/Username (required)
  - Repositories (optional, comma-separated)

## Data Format

The component manages an array of integration objects:

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

## Example Configuration Flow

1. User searches for "GitHub" in the search field
2. User clicks "Add Integration" on the GitHub card
3. Configuration dialog opens with GitHub-specific fields
4. User fills in access token, organization, and optional repositories
5. User clicks "Add Integration" to save
6. Integration appears in the "Configured Integrations" list
7. User can edit or delete the integration using the action buttons

## UX Features

- **Search**: Fuzzy search through integration names and descriptions
- **Progressive Disclosure**: Only shows relevant integrations
- **Status Indicators**: Clear visual feedback for integration status
- **Validation**: Real-time validation with helpful error messages
- **Accessibility**: Full keyboard navigation and screen reader support

## Extension

To add new integrations, update the `AVAILABLE_INTEGRATIONS` array in the component:

```typescript
{
  type: "slack",
  name: "Slack",
  description: "Connect to Slack for notifications and updates",
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
