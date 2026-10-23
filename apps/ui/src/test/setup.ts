import '@testing-library/jest-dom'
import { beforeAll, afterEach, afterAll, vi } from 'vitest'
import { setupServer } from 'msw/node'
import WS from 'jest-websocket-mock'

// Use vi instead of jest for global mocks
global.fetch = vi.fn()

// jsdom does not implement ResizeObserver. Some linked ui-common modules
// construct one during module evaluation, so install the test double before
// test modules are imported.
globalThis.ResizeObserver = class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver

// Mock window.matchMedia for animations
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Handle unhandled rejections during tests (expected in error tests)
process.on('unhandledRejection', (reason, promise) => {
  // Only suppress specific test errors, not all unhandled rejections
  if (reason instanceof Error && reason.message === 'Fetch failed') {
    // This is expected from our error handling tests
    return
  }
  // Re-throw other unhandled rejections
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

// Create MSW server instance
const server = setupServer()

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

// Reset handlers after each test `important for test isolation`
afterEach(() => {
  server.resetHandlers()
  // Clean up WebSocket mocks after each test
  WS.clean()
  // Clear all vitest mocks
  vi.clearAllMocks()
})

// Clean up after all tests
afterAll(() => server.close())

// Make server available globally for test setup
globalThis.mswServer = server
