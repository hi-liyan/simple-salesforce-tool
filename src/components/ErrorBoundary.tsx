import React from "react";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = {
    hasError: false,
    message: ""
  };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error)
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Keep stack in console for diagnosis.
    // eslint-disable-next-line no-console
    console.error("UI crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, fontFamily: "sans-serif" }}>
          <h3>页面渲染异常</h3>
          <p>检测到前端运行时错误，已阻止整页白屏。</p>
          <pre style={{ whiteSpace: "pre-wrap", color: "#b42318" }}>{this.state.message}</pre>
          <button onClick={() => window.location.reload()}>刷新页面</button>
        </div>
      );
    }

    return this.props.children;
  }
}
