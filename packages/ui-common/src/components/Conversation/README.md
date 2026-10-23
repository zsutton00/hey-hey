# ConversationNavigator

A flexible conversation navigation component that dynamically builds breadcrumbs and progress indicators from conversation message data.

## Features

- **Dynamic Navigation**: Automatically builds navigation from `SystemMessage.data.title` fields
- **Dual Orientations**: Horizontal stepper or vertical sidebar layouts
- **Progress Tracking**: Visual progress indicators and completion states
- **Interactive Navigation**: Click to navigate between conversation steps (vertical mode)
- **Responsive Animations**: Smooth transitions and micro-interactions

## Usage

### Horizontal Orientation (Traditional Stepper)

```tsx
<ConversationNavigator
  conversation={conversationData}
  orientation="horizontal"
  activeStep={currentStepIndex}
  title="Project Onboarding"
  subtitle="Let's get your project set up"
  showProgress={true}
/>
```

### Vertical Orientation (Sidebar Navigation)

```tsx
<ConversationNavigator
  conversation={conversationData}
  orientation="vertical"
  activeStep={currentStepIndex}
  onStepClick={(stepIndex, message) => {
    // Handle navigation to specific step
    navigateToStep(stepIndex);
  }}
/>
```

## Props

| Prop           | Type                                                       | Default        | Description                                    |
| -------------- | ---------------------------------------------------------- | -------------- | ---------------------------------------------- |
| `conversation` | `ConversationResponseDto`                                  | -              | **Required.** Conversation containing messages |
| `orientation`  | `"horizontal" \| "vertical"`                               | `"horizontal"` | Layout orientation                             |
| `activeStep`   | `number`                                                   | `0`            | Current active step index                      |
| `title`        | `string`                                                   | -              | Optional title for horizontal mode             |
| `subtitle`     | `string`                                                   | -              | Optional subtitle for horizontal mode          |
| `onStepClick`  | `(stepIndex: number, message: MessageResponseDto) => void` | -              | Callback for step navigation (vertical mode)   |
| `showProgress` | `boolean`                                                  | `true`         | Show progress bar (horizontal mode)            |
| `className`    | `string`                                                   | -              | Custom CSS class                               |

## Data Requirements

The component automatically extracts navigation steps from conversation messages where:

- `message.type === "SYSTEM"`
- `message.data.title` exists and is not empty

Each qualifying message becomes a navigation step with:

- **Title**: From `message.data.title`
- **Status**: Completed if user has responded, active if current step
- **Content Preview**: From `message.data.response` (vertical mode only)

## Examples

### Basic Horizontal Stepper

```tsx
const activeStepIndex = 2; // Currently on step 3

<ConversationNavigator
  conversation={conversation}
  orientation="horizontal"
  activeStep={activeStepIndex}
  title="Onboarding Process"
  showProgress={true}
/>;
```

### Interactive Sidebar

```tsx
<ConversationNavigator
  conversation={conversation}
  orientation="vertical"
  activeStep={activeStepIndex}
  onStepClick={(stepIndex, message) => {
    // Navigate to specific conversation step
    setActiveStep(stepIndex);
    scrollToMessage(message.id);
  }}
/>
```

### Layout Integration

```tsx
<Grid container spacing={3}>
  <Grid item xs={3}>
    <ConversationNavigator
      conversation={conversation}
      orientation="vertical"
      activeStep={activeStep}
      onStepClick={handleStepNavigation}
    />
  </Grid>
  <Grid item xs={9}>
    <ConversationContent conversation={conversation} />
  </Grid>
</Grid>
```

## Styling

The component uses Material-UI's theming system and supports:

- **Theme Colors**: Primary, success, grey palette
- **Custom Variants**: Paper elevation, border radius from theme
- **Responsive Design**: Adapts to container width
- **Motion**: Framer Motion animations for state changes

## Migration from OnboardingStepper

The ConversationNavigator replaces the hardcoded OnboardingStepper:

```tsx
// Before (OnboardingStepper)
<OnboardingStepper
  steps={hardcodedSteps}
  activeStep={activeStepIdx}
  project={project}
  // ... other props
/>

// After (ConversationNavigator)
<ConversationNavigator
  conversation={activeConversation}
  orientation="horizontal"
  activeStep={calculatedActiveStep}
  title={t("onboarding.title")}
  subtitle={t("onboarding.subtitle")}
  showProgress={true}
/>
```

Key improvements:

- ✅ Dynamic steps from actual conversation data
- ✅ No hardcoded step definitions required
- ✅ Works with any conversation type
- ✅ Dual orientation support
- ✅ Better navigation UX in vertical mode
