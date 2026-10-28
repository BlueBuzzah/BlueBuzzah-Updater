import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// Component that throws during render
function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test render error');
  }
  return <div>Child content</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('catches render errors and shows fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText("The Updater hit a problem it couldn't recover from. Restart it to continue.")).toBeInTheDocument();
    expect(screen.getByText('Test render error')).toHaveClass('code-s');
    expect(screen.getByRole('button', { name: 'Copy details' })).toBeInTheDocument();
  });

  it('shows restart button in fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByRole('button', { name: /^restart the updater$/i })).toBeInTheDocument();
  });

  it('calls window.location.reload on restart click', () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    });

    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByRole('button', { name: /^restart the updater$/i }));

    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it('logs error to console via componentDidCatch', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      '[ErrorBoundary] Uncaught error:',
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) })
    );
  });
});
