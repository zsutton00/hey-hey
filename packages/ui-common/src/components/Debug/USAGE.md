# WebSocket Debug UI Usage Guide

The WebSocket Debug UI provides comprehensive debugging capabilities for real-time data synchronization issues. This guide explains how to access and use all the debug features.

## Quick Start

### 1. Accessing Debug Mode

**Development Mode (Automatic):**

- The debug system is automatically enabled in development mode
- Look for a floating debug button (🐛) in the bottom-right corner
- Click the button to open the debug panel

**Keyboard Shortcuts:**

- `Ctrl+Shift+D` - Toggle debug panel
- `Ctrl+Shift+M` - Open full debug modal
- `Ctrl+Shift+W` - Toggle panel expand/collapse
- `Ctrl+Shift+X` - Clear event logs
- `Ctrl+Shift+E` - Export debug data
- `Escape` - Close all debug interfaces

### 2. Browser Console Access

In development mode, debug controls are available globally:

```javascript
// Toggle debug panel
window.debugControls.togglePanel();

// Open full debug modal
window.debugControls.openModal();

// Close all debug interfaces
window.debugControls.closeAll();

// Check visibility
window.debugControls.isVisible();
window.debugControls.isModalOpen();

// Access WebSocket debugger
window.wsDebug.getStats();
window.wsDebug.generateReport();
```

## Features Overview

### 1. Debug Panel (Floating UI)

**Location:** Bottom-left corner (configurable)
**Size:** Expandable/collapsible

**Tabs:**

- **Events** - Real-time event log with filtering
- **Stats** - Connection and subscription statistics

**Quick Stats Bar:**

- Event count badge
- Active subscriptions count
- Duplicate subscriptions warning
- Recent error count

### 2. Debug Modal (Full-Screen)

**Access:** Click fullscreen button or `Ctrl+Shift+M`

**Tabs:**

- **Events** - Advanced event filtering and search
- **Subscriptions** - Detailed subscription management
- **Connection** - Connection health and status
- **Analytics** - Performance metrics and statistics
- **Settings** - Debug preferences and export options

### 3. Event Log Features

**Real-time Display:**

- Live-updating event feed
- Color-coded event types
- Expandable event details
- Timestamp display (absolute and relative)

**Filtering Options:**

- Filter by event type
- Filter by source
- Text search across event data
- Time range filtering
- Show errors only toggle

**Event Types:**

- `subscription_created` - New subscription established
- `subscription_removed` - Subscription cleaned up
- `subscription_updated` - Subscription configuration changed
- `websocket_event` - Real-time data received
- `cache_update` - Local cache updated

### 4. Statistics Monitoring

**Connection Health:**

- Connection status (Connected/Disconnected/Unauthenticated)
- Uptime tracking
- Reconnection attempts
- Average latency (when available)
- Error reporting

**Subscription Statistics:**

- Total active subscriptions
- Unique data subscriptions
- Duplicate subscriptions (efficiency indicator)
- Reference counting per subscription
- Configuration details

**Event Analytics:**

- Total event count
- Recent activity (last 5 minutes)
- Error rate percentage
- Events by type breakdown
- Events by source analysis

## Troubleshooting Guide

### Common Issues

**1. Debug Panel Not Visible**

- Check if in development mode: `process.env.NODE_ENV === 'development'`
- Look for floating debug button (🐛) in bottom-right corner
- Try keyboard shortcut: `Ctrl+Shift+D`
- Check browser console for errors

**2. No WebSocket Events Showing**

- Verify WebSocket connection is established
- Check connection status in Stats tab
- Look for connection errors in event log
- Ensure you're on a page that uses WebSocket features

**3. High Error Rate**

- Review error events in Events tab with "Errors only" filter
- Check connection stability
- Look for authentication issues
- Verify server endpoint configuration

**4. Memory Issues**

- Monitor event count (default limit: 1000 events)
- Clear logs regularly with `Ctrl+Shift+X`
- Reduce max events in settings if needed
- Check for subscription leaks in Stats tab

### Performance Optimization

**Best Practices:**

- Clear logs periodically to prevent memory buildup
- Use filters to focus on relevant events
- Export data before clearing for later analysis
- Monitor duplicate subscriptions (should be 0)
- Keep debug panel collapsed when not actively debugging

## Data Export

### Export Formats

- **JSON** - Complete debug session data
- **CSV** - Events in spreadsheet format

### Export Contents

- Session information (URL, user agent, duration)
- Connection health metrics
- Subscription details and configurations
- Complete event log with metadata
- Performance statistics
- Error summaries

### Sharing Debug Data

1. Export debug session: `Ctrl+Shift+E`
2. Save file with timestamp
3. Share with development team
4. Include steps to reproduce issues

## Development Integration

### Custom Event Logging

Add custom debug events in your code:

```typescript
import { subscriptionManager } from "../data/websockets/manager";

// Log custom debug event
subscriptionManager.logEvent({
  type: "custom_event",
  data: { operation: "data_sync", status: "success" },
  source: "MyComponent",
  metadata: { timestamp: Date.now() },
});
```

### Integration with Existing Debug Tools

The WebSocket debug system integrates with:

- Browser DevTools Network tab
- React DevTools
- Redux DevTools (if used)
- Custom logging systems

## Advanced Usage

### Programmatic Access

```typescript
import { useDebugManager } from "../components/Debug";

function MyComponent() {
  const { toggleDebug, openDebugModal, isDebugVisible } = useDebugManager();

  // Custom debug trigger
  const handleDebugTrigger = () => {
    if (!isDebugVisible()) {
      toggleDebug();
    }
  };
}
```

### Custom Debug Hooks

```typescript
import { useWebSocketDebug } from "../data/websockets/debug";

function useCustomDebugAnalytics() {
  const { events, connectionState } = useWebSocketDebug();

  return {
    isHealthy: connectionState.isConnected && connectionState.isAuthenticated,
    recentErrors: events.filter((e) => e.metadata?.success === false),
    eventRate: events.length / (Date.now() / 60000), // events per minute
  };
}
```

## Security Considerations

- Debug mode is automatically disabled in production
- Sensitive data is sanitized from debug logs
- Debug controls are only available to authenticated users
- Export data may contain sensitive information - handle carefully
- Network requests and responses are not logged by default

## Future Enhancements

Planned features:

- Performance profiling and metrics visualization
- WebSocket message replay functionality
- Integration with backend debug endpoints
- Automated error reporting
- Real-time collaboration debugging
- Advanced filtering and search capabilities

---

For technical support or feature requests, check the project repository issues or contact the development team.
