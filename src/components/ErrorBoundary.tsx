import { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, OctagonAlert } from 'lucide-react';
import { ICON } from '@/components/ui/icon';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  handleRestart = (): void => {
    window.location.reload();
  };

  copyDetails = (): void => {
    navigator.clipboard?.writeText(this.state.error?.stack ?? this.state.error?.message ?? '').catch(() => {});
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="grid min-h-screen place-items-center bg-surface p-10 text-ink">
          <div className="grid w-full max-w-prose gap-6">
            <OctagonAlert size={ICON.l} className="text-danger" />
            <h1 className="headline">Something went wrong</h1>
            <p className="body">The Updater hit a problem it couldn&apos;t recover from. Restart it to continue.</p>
            {this.state.error && (
              <p className="code-s whitespace-pre-wrap rounded-md bg-surface-sunken p-4 text-ink-muted">{this.state.error.message}</p>
            )}
            <div className="flex flex-wrap gap-target-gap">
              <Button variant="secondary" icon={Copy} onClick={this.copyDetails}>
                Copy details
              </Button>
              <Button onClick={this.handleRestart}>Restart the Updater</Button>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
