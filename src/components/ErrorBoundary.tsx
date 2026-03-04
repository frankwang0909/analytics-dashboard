import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Class component required — React error boundaries cannot be function components.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-lg font-semibold text-gray-800 mb-1">Something went wrong</p>
          <p className="text-sm text-gray-400 mb-4">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-full hover:bg-blue-700 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
