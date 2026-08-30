import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("MyTime UI crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 32,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          background: "#f4f4f8",
          color: "#1a1a22",
        }}
      >
        <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
          MyTime hit a display error
        </p>
        <p style={{ fontSize: 13, color: "#5c5c6e", maxWidth: 420, textAlign: "center" }}>
          {this.state.error.message || "The window stayed open, but the UI stopped rendering."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 8,
            borderRadius: 8,
            border: "1px solid #c8c8d4",
            background: "#fff",
            padding: "8px 14px",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Reload window
        </button>
      </div>
    );
  }
}
