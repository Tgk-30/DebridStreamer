// A render error boundary so an uncaught throw shows a recovery card instead of
// a blank white screen. Two levels are used (see App.tsx): an outer boundary
// (reload-only) around the whole shell, and an inner one around the active
// screen that offers "Go home" so a single screen crash doesn't sink the app.

import { Component, type ErrorInfo, type ReactNode } from "react";
import "./ErrorBoundary.css";

interface Props {
  children: ReactNode;
  /** Shown in the console log + used to distinguish boundaries. */
  label?: string;
  /** When provided, the card offers "Go home" (this callback) in addition to a
   *  full reload — for a per-screen boundary. Omit for the top-level boundary. */
  onGoHome?: () => void;
  /** Changing this value clears a caught error (e.g. pass the route so
   *  navigating away from a crashed screen recovers automatically). */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface for diagnosis; no telemetry is sent.
    console.error(
      `[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ""}]`,
      error,
      info.componentStack,
    );
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error != null && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private goHome = (): void => {
    this.setState({ error: null });
    this.props.onGoHome?.();
  };

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error == null) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary-card glass-raised glass-lit">
          <h2 className="error-boundary-title">Something went wrong</h2>
          <p className="error-boundary-msg">
            {error.message || "An unexpected error occurred."}
          </p>
          <div className="error-boundary-actions">
            {this.props.onGoHome != null && (
              <button
                type="button"
                className="btn btn-prominent"
                onClick={this.goHome}
              >
                Go home
              </button>
            )}
            <button
              type="button"
              className={
                this.props.onGoHome != null ? "btn" : "btn btn-prominent"
              }
              onClick={this.reload}
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
