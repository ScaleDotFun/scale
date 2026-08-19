import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            gap: 16,
            padding: 32,
          }}
        >
          <div>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h2 style={{ margin: 0 }}>Something went wrong</h2>
          <p style={{ fontSize: '0.86rem', color: 'var(--text-2)', maxWidth: 400, textAlign: 'center' }}>
            An unexpected error occurred. Try refreshing the page.
          </p>
          {this.state.error && (
            <pre
              style={{
                fontSize: '0.75rem',
                color: 'var(--red)',
                background: 'rgba(255, 0, 0, 0.05)',
                padding: '12px 16px',
                borderRadius: 0,
                maxWidth: '100%',
                overflow: 'auto',
              }}
            >
              {this.state.error.message}
            </pre>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.href = '/';
            }}
          >
            Return to Home
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
