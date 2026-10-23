# Universal Drag and Drop System

A type-safe, accessible drag and drop system built with `@dnd-kit` and enhanced with smooth **Framer Motion animations** for handling universal content (artifacts, conversations, initiatives, files).

## Installation

The required packages are already installed:

- `@dnd-kit/core`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`
- `motion` (Framer Motion) for animations
- `react-filepond` + `filepond` for advanced file uploads
- FilePond plugins for image preview, validation, and more

## Quick Start

### 1. Choose Your Provider

**Basic (no animations):**

```tsx
import { DndProvider } from "./components/dnd";

function App() {
  return <DndProvider>{/* Your app content */}</DndProvider>;
}
```

**Animated (with Framer Motion):**

```tsx
import { AnimatedDndProvider } from "./components/dnd";

function App() {
  return (
    <AnimatedDndProvider
      animation={{
        enabled: true,
        duration: 0.3,
        scale: { hover: 1.02, drag: 0.95 },
        opacity: { drag: 0.8 },
      }}
    >
      {/* Your app content */}
    </AnimatedDndProvider>
  );
}
```

### 2. Make any content heyhey

**Basic:**

```tsx
import { DndContextItem } from "./components/dnd";

<DndContextItem content={artifactData}>
  <MyArtifactComponent />
</DndContextItem>;
```

**Animated:**

```tsx
import { AnimatedDndContextItem } from "./components/dnd";

<AnimatedDndContextItem
  content={artifactData}
  animation={{
    scale: { hover: 1.05, drag: 0.9 },
    rotate: { hover: 2, drag: 5 },
  }}
>
  <MyArtifactComponent />
</AnimatedDndContextItem>;
```

### 3. Create drop zones

**Basic:**

```tsx
import { DndContextDropSite } from "./components/dnd";

<DndContextDropSite
  acceptedTypes={["artifact", "conversation"]}
  onDrop={(event) => {
    console.log("Dropped:", event.content);
  }}
>
  <div>Drop artifacts and conversations here</div>
</DndContextDropSite>;
```

**Animated:**

```tsx
import { AnimatedDndContextDropSite } from "./components/dnd";

<AnimatedDndContextDropSite
  acceptedTypes={["artifact", "conversation"]}
  acceptFiles={true}
  onDrop={handleDrop}
  onFileDrop={handleFileDrop}
  animation={{
    scale: { hover: 1.02, drop: 1.05 },
    duration: 0.3,
  }}
>
  <div>Drop items or files here with smooth animations!</div>
</AnimatedDndContextDropSite>;
```

## Supported Content Types

- **artifact**: `CreateArtifactDto` data
- **conversation**: `ConversationResponseDto` data
- **initiative**: `InitiativeResponseDto` data
- **file**: `FileContent` data - Any file dropped from the OS

## API Reference

### DndProvider

The root provider that manages global drag state.

```tsx
interface DndProviderProps {
  children: React.ReactNode;
  dragPreviewRenderer?: (props: DragPreviewProps) => React.ReactNode;
}
```

### DndContextItem

Wrapper component that makes any content heyhey.

```tsx
interface DndContextItemProps {
  content: DraggableContent;
  children: React.ReactNode;
  id?: string;
  disabled?: boolean;
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  className?: string;
}
```

### DndContextDropSite

Component that creates drop zones for heyhey content and files from the OS.

```tsx
interface DndContextDropSiteProps {
  children: React.ReactNode;
  id?: string;
  acceptedTypes?: DraggableContentType[];
  disabled?: boolean;
  onDrop?: (event: DropEvent) => void;
  onFileDrop?: (event: FileDropEvent) => void;
  onDragOver?: (content: DraggableContent) => void;
  onDragLeave?: () => void;
  className?: string;
  acceptFiles?: boolean;
  maxFileSize?: number;
  acceptedFileTypes?: string[];
}
```

## Events

### DragStartEvent

```tsx
interface DragStartEvent {
  content: DraggableContent;
  sourceId: string;
}
```

### DragEndEvent

```tsx
interface DragEndEvent {
  content: DraggableContent;
  sourceId: string;
  targetId?: string;
  success: boolean;
}
```

### DropEvent

```tsx
interface DropEvent {
  content: DraggableContent;
  sourceId: string;
  targetId: string;
}
```

### FileDropEvent

```tsx
interface FileDropEvent {
  files: File[];
  targetId: string;
}
```

## Custom Drag Previews

You can customize the drag preview by providing a custom renderer:

```tsx
const customPreviewRenderer = ({ content, isDragging }: DragPreviewProps) => (
  <div style={{ opacity: isDragging ? 0.8 : 1 }}>
    Custom preview for {content.type}
  </div>
);

<DndProvider dragPreviewRenderer={customPreviewRenderer}>
  {/* Your app */}
</DndProvider>;
```

## Type Safety

All content is fully typed with TypeScript. The system uses discriminated unions to ensure type safety:

```tsx
type DraggableContent =
  | { type: "artifact"; data: CreateArtifactDto }
  | { type: "conversation"; data: ConversationResponseDto }
  | { type: "initiative"; data: InitiativeResponseDto }
  | { type: "file"; data: FileContent };
```

## Accessibility

Built on `@dnd-kit`, this system includes:

- Keyboard navigation support
- Screen reader announcements
- Focus management
- ARIA attributes

## Performance

- Lightweight core (~10kb)
- No HTML5 DnD API dependencies
- Smooth 60fps animations
- Minimal re-renders

## 🎭 Animation System

The system includes a comprehensive animation framework powered by Framer Motion:

### Animation Configuration

```tsx
interface AnimationConfig {
  enabled?: boolean;
  duration?: number;
  ease?: string | number[];
  scale?: {
    hover?: number; // Scale on hover (e.g., 1.02)
    drag?: number; // Scale while dragging (e.g., 0.95)
    drop?: number; // Scale on successful drop (e.g., 1.1)
  };
  opacity?: {
    drag?: number; // Opacity while dragging (e.g., 0.8)
    drop?: number; // Opacity on drop (e.g., 0.6)
  };
  rotate?: {
    hover?: number; // Rotation on hover (e.g., 2)
    drag?: number; // Rotation while dragging (e.g., 5)
  };
}
```

### Built-in Animation Features

**Drag Items:**

- ✨ Hover effects (scale, rotate)
- 🎯 Drag feedback (opacity, scale, rotation)
- 🎪 Smooth transitions with easing
- 🔄 Spring animations for natural feel

**Drop Zones:**

- 🌟 Drag-over highlighting
- 📍 Animated drop indicators
- 💫 Pulsing effects during drag
- 🎆 Success animations on drop

**File Previews:**

- 🎬 Staggered entrance animations
- 🖼️ Image fade-ins with scale
- 📄 Text content reveals
- 🎨 Validation status animations

### Animation Examples

**Custom Drag Animation:**

```tsx
<AnimatedDndContextItem
  content={content}
  animation={{
    enabled: true,
    duration: 0.4,
    ease: [0.25, 0.46, 0.45, 0.94],
    scale: { hover: 1.05, drag: 0.9 },
    rotate: { hover: 3, drag: 8 },
    opacity: { drag: 0.7 },
  }}
>
  <MyComponent />
</AnimatedDndContextItem>
```

**Animated File Grid:**

```tsx
<AnimatedFileGrid
  files={files}
  animation={{
    duration: 0.3,
    scale: { hover: 1.03 },
  }}
  staggerDelay={0.1} // Delay between each file animation
/>
```

### Performance Optimizations

- 🚀 GPU-accelerated transforms
- ⚡ Optimized re-renders with React.memo
- 🎯 Efficient animation cleanup
- 📱 Smooth 60fps animations
- 🔧 Configurable animation complexity

## 📁 FilePond Integration

The system now includes **FilePond** - a powerful JavaScript library for file uploads with beautiful animations and advanced features:

### FilePond Features

- 🎨 **Beautiful UI** - Polished interface with smooth animations
- 🖼️ **Image Previews** - Automatic image thumbnails and editing
- ✅ **Advanced Validation** - File type, size, and custom validation
- 📤 **Flexible Upload** - Local processing or server upload
- ♿ **Accessibility** - Full keyboard navigation and screen reader support
- 📱 **Responsive** - Works perfectly on mobile devices

### Basic FilePond Usage

```tsx
import { FilePondDropZone } from "./components/dnd";

<FilePondDropZone
  onFilesAdded={(files) => console.log("Files added:", files)}
  acceptedFileTypes={[".pdf", ".txt", ".md", "image/*"]}
  maxFileSize={10 * 1024 * 1024} // 10MB
  maxFiles={5}
  instantUpload={false}
/>;
```

### Hybrid Drop Zone

Combines FilePond with our existing drag & drop system:

```tsx
import { HybridDndDropZone } from "./components/dnd";

<HybridDndDropZone
  title="Universal Drop Zone"
  subtitle="Drag items or upload files"
  enableFilePond={true}
  showModeToggle={true}
  defaultMode="both"
  // FilePond options
  filePondMaxFiles={10}
  filePondInstantUpload={false}
  filePondServer="/api/upload"
  // Drag & drop options
  acceptedTypes={["artifact", "conversation", "file"]}
  onDrop={handleDrop}
  onFileDrop={handleFileDrop}
  onFilePondFilesAdded={handleFilePondFiles}
  onHybridContentAdded={handleAllContent}
/>;
```

### FilePond Modes

The hybrid system supports three modes:

1. **DnD Only** - Traditional drag & drop for internal content
2. **FilePond Only** - Advanced file upload interface
3. **Both** - Side-by-side file upload and drag & drop

### Custom Styling

FilePond includes a custom theme that matches your design:

```css
/* Import the custom theme */
@import "./styles/filepond-theme.css";
```

**Theme Features:**

- 🎨 Gradient backgrounds and smooth transitions
- ✨ Hover effects and micro-interactions
- 🌊 Animated drag states and progress indicators
- 🎯 Success/error animations with visual feedback
- 📱 Responsive design with mobile optimization
- 🌙 Dark mode support
- ♿ Accessibility enhancements

### Advanced Configuration

```tsx
<FilePondDropZone
  // Validation
  acceptedFileTypes={[".pdf", ".docx", ".txt", ".md", ".py", ".js", "image/*"]}
  maxFileSize={50 * 1024 * 1024} // 50MB
  maxFiles={10}
  // Upload behavior
  instantUpload={true}
  server={{
    url: "/api/upload",
    process: "/process",
    revert: "/revert",
    headers: { Authorization: "Bearer token" },
  }}
  // UI customization
  labelIdle="Drag files here or browse"
  showValidation={true}
  // Callbacks
  onFilesAdded={(files) => console.log("Added:", files)}
  onFileDropEvent={(event) => console.log("Dropped:", event)}
  onFileContentCreated={(content) => console.log("Content:", content)}
/>
```

## File Support

The system supports dropping files directly from the OS with advanced validation and processing:

### File Validation

```tsx
import { validateFile, isFileAnalyzableByLLM } from "./components/dnd";

const result = validateFile(file);
if (result.isLLMAnalyzable) {
  // File can be analyzed by LLMs
}
```

### LLM-Analyzable File Types

Supported file types for LLM analysis include:

- **Text**: `.txt`, `.md`, `.csv`, `.html`, `.css`, `.xml`, `.rtf`
- **Code**: `.js`, `.ts`, `.py`, `.java`, `.c`, `.cpp`, `.cs`, `.php`, `.rb`, `.go`, `.rs`, `.sql`
- **Documents**: `.pdf`, `.doc`, `.docx`, `.odt`
- **Spreadsheets**: `.xls`, `.xlsx`, `.ods`, `.csv`
- **Presentations**: `.ppt`, `.pptx`, `.odp`
- **Images**: `.jpg`, `.png`, `.gif`, `.bmp`, `.webp`, `.svg`
- **Data**: `.json`, `.xml`, `.yaml`, `.toml`

### File Processing

```tsx
import { processFiles, FileGrid } from "./components/dnd";

const handleFileDrop = async (event: FileDropEvent) => {
  const processed = await processFiles(event.files);
  // processed files include validation, previews, and metadata
};

// Display processed files
<FileGrid files={processedFiles} showValidation={true} />;
```

### File Restrictions

```tsx
<DndContextDropSite
  acceptFiles={true}
  maxFileSize={10 * 1024 * 1024} // 10MB limit
  acceptedFileTypes={[".pdf", ".txt", ".py", "image/*"]}
  onFileDrop={handleFileDrop}
>
  <div>Drop files here</div>
</DndContextDropSite>
```

## Example Usage

See `DndExample.tsx` for a complete working example demonstrating:

- Multiple content types
- Type-restricted drop zones
- File dropping from OS
- File validation and processing
- Event handling
- Visual feedback
