import { Component, type ErrorInfo, type ReactNode } from 'react';
import * as Sentry from '@sentry/browser';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import {
  useSettingsStore,
  selectEffectiveTelemetryCrash,
} from '@/stores/settings-store';

interface ErrorBoundaryProps {
  children: ReactNode;
  name: string;
  fallback?: ReactNode;
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
    // Report to Sentry (via the Rust-injected plugin client) before rendering the
    // fallback, but only when the user's effective crash-reporting consent is on.
    // Wrapped in try/catch so capture can never worsen an already-broken render path.
    // When telemetry is off or no client is bound, captureException is a silent no-op.
    try {
      if (selectEffectiveTelemetryCrash(useSettingsStore.getState())) {
        Sentry.captureException(error, {
          contexts: { react: { componentStack: info.componentStack } },
        });
      }
    } catch {
      /* never let crash reporting throw inside an error boundary */
    }
    console.error(`[ErrorBoundary:${this.props.name}]`, error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
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
