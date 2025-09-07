/**
 * ErrorBoundary - Error boundary component for chart rendering
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: React.ComponentType<{ error: Error; retry: () => void }>;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  maxRetries?: number;
  retryDelay?: number;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private retryTimeoutId: NodeJS.Timeout | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo
    });

    // Call onError callback if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Log error for debugging
    console.error('Chart Error Boundary caught an error:', error, errorInfo);
  }

  componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  handleRetry = () => {
    const { maxRetries = 3, retryDelay = 1000 } = this.props;
    const { retryCount } = this.state;

    if (retryCount >= maxRetries) {
      console.warn('Maximum retry attempts reached');
      return;
    }

    // Clear any existing timeout
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }

    // Set timeout for retry
    this.retryTimeoutId = setTimeout(() => {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        retryCount: retryCount + 1
      });
    }, retryDelay);
  };

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0
    });
  };

  render() {
    const { hasError, error, retryCount } = this.state;
    const { children, fallback, maxRetries = 3 } = this.props;

    if (hasError && error) {
      // Use custom fallback if provided
      if (fallback) {
        const FallbackComponent = fallback;
        return (
          <FallbackComponent
            error={error}
            retry={this.handleRetry}
          />
        );
      }

      // Default error UI
      return (
        <Card className="glass-panel p-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <h3 className="text-lg font-semibold text-destructive">
                Chart Error
              </h3>
            </div>

            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error.message || 'An unexpected error occurred while rendering the chart'}
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={this.handleRetry}
                  disabled={retryCount >= maxRetries}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {retryCount >= maxRetries ? 'Max Retries Reached' : 'Retry'}
                </Button>
                
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={this.handleReset}
                >
                  Reset
                </Button>
              </div>

              {retryCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  Retry attempt: {retryCount} / {maxRetries}
                </p>
              )}

              {retryCount >= maxRetries && (
                <p className="text-xs text-destructive">
                  Maximum retry attempts reached. Please refresh the page or contact support.
                </p>
              )}
            </div>

            {/* Development error details */}
            {process.env.NODE_ENV === 'development' && (
              <details className="mt-4">
                <summary className="text-sm font-medium cursor-pointer text-muted-foreground">
                  Error Details (Development)
                </summary>
                <div className="mt-2 p-3 bg-muted rounded-md">
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {error.stack}
                  </pre>
                </div>
              </details>
            )}
          </div>
        </Card>
      );
    }

    return children;
  }
}

export default ErrorBoundary;
