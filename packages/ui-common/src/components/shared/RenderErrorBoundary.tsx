import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

export interface RenderErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface RenderErrorBoundaryState {
  hasError: boolean;
}

export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  state: RenderErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RenderErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
