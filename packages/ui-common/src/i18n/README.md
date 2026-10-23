# 🌟 I18n Composition System

A powerful, composable internationalization system that enables easy terminology changes across your entire application.

## 🎯 The Problem We Solved

**Before:** Changing business terminology (like "initiatives" to "goals") required updating dozens of individual translation strings.

**After:** One line change updates terminology everywhere:

```typescript
setTerminology(GOAL_FOCUSED_TERMINOLOGY);
// All strings automatically update across the entire app!
```

## 🚀 Usage Examples

### Basic Composition

```typescript
import { compose, TERMS } from "../i18n";

const welcomeMsg = compose("Welcome to {{term.Initiative}} Editor");
// → "Welcome to Initiative Editor" or "Welcome to Goal Editor"
```

### Pattern Usage

```typescript
import { patterns } from "../i18n";

patterns.newEntity("initiative"); // → "New Initiative" | "New Goal"
patterns.editEntity("task"); // → "Edit Task" | "Edit Action"
patterns.noEntitiesFound("projects"); // → "No projects found"
```

### Terminology Switching

```typescript
import { setTerminology, GOAL_FOCUSED_TERMINOLOGY } from "../i18n";

setTerminology(GOAL_FOCUSED_TERMINOLOGY);
// Now "initiatives" become "goals" everywhere!
```

## 🏗️ Architecture

1. **Terminology System** - Central business term definitions
2. **Composition Engine** - Template-based string building
3. **Pattern Library** - Reusable string patterns
4. **Enhanced Translations** - Composable translation files

## ✨ Benefits

- **Single Point of Change:** Update terminology in one place
- **Type Safety:** Full TypeScript support
- **Backwards Compatible:** Existing code continues to work
- **Scalable:** Easy to add new terminology sets

## 🧪 Demo

Open `src/i18n/demo.html` to see the system in action!
