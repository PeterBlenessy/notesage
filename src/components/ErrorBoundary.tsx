import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  name: string;
  /**
   * Replaces the default fallback. Pass a function to get the caught error
   * and a `reset` that clears the boundary and re-renders the children — a
   * static node leaves the user with no way out short of restarting the app.
   */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name}]`, error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error ?? new Error('Unknown error'), this.handleReload);
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <AlertTriangle className="size-8 text-muted-foreground" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium text-foreground">
                Something went wrong in {this.props.name}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {this.state.error?.message}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={this.handleReload}>
              Reload
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
