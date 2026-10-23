/**
 * Test that debug components use WebSocket context instead of singleton
 */

import { render } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai";
import React from "react";
import { WebSocketProvider } from "../../../contexts/WebSocketContext";
import { AuthProvider } from "../../../contexts/AuthContext";
import { useWebSocketDebug, useWebSocketDebugger } from "../debug";

// Mock user identity hook
vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: () => ({
    email: "test@example.com",
  }),
}));

// Mock auth context
vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: "user-123", email: "test@example.com" },
    loading: false,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Test component that uses debug hook
const TestDebugComponent: React.FC = () => {
  const debugState = useWebSocketDebug();
  return React.createElement("div", {
    "data-testid": "debug-events-count",
    children: debugState.events.length,
  });
};

// Test component that uses debugger hook
const TestDebuggerComponent: React.FC = () => {
  const wsDebugger = useWebSocketDebugger();
  return React.createElement("div", {
    "data-testid": "debugger-ready",
    children: wsDebugger ? "ready" : "not ready",
  });
};

describe("Debug Context Migration", () => {
  it("should use WebSocket context in debug hook", () => {
    const store = createStore();

    const { getByTestId } = render(
      React.createElement(
        Provider,
        { store },
        React.createElement(
          AuthProvider,
          {},
          React.createElement(
            WebSocketProvider,
            {},
            React.createElement(TestDebugComponent)
          )
        )
      )
    );

    // Should render without throwing
    expect(getByTestId("debug-events-count")).toBeInTheDocument();
  });

  it("should use WebSocket context in debugger hook", () => {
    const store = createStore();

    const { getByTestId } = render(
      React.createElement(
        Provider,
        { store },
        React.createElement(
          AuthProvider,
          {},
          React.createElement(
            WebSocketProvider,
            {},
            React.createElement(TestDebuggerComponent)
          )
        )
      )
    );

    // Should render without throwing
    expect(getByTestId("debugger-ready")).toHaveTextContent("ready");
  });

  it("should handle gracefully when used outside WebSocket context", () => {
    const store = createStore();

    // Mock console.warn to check for the warning message
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { getByTestId } = render(
      React.createElement(
        Provider,
        { store },
        React.createElement(TestDebugComponent)
      )
    );

    // The component should render with fallback state (0 events)
    expect(getByTestId("debug-events-count").textContent).toBe("0");

    // Check that a warning was logged
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
