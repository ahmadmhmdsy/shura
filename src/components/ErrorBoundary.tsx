import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ar } from "@/i18n/ar";
import { logger } from "@/lib/logging";

interface ErrorBoundaryProps { children: ReactNode; }
interface ErrorBoundaryState { error: Error | null; }

/**
 * Last-resort render guard. A throw during render would otherwise unmount the whole tree
 * and leave a blank window with no way back; here the user keeps a reload path and the
 * error still reaches the normal logging pipeline.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error("React render error", { componentStack: info.componentStack ?? undefined }, error);
  }

  private readonly reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div dir="rtl" role="alert" className="grid h-full place-items-center p-8 text-center">
        <div className="flex max-w-md flex-col items-center gap-4">
          <h1 className="text-[var(--sura-text-h2)] font-[var(--sura-font-semibold)] text-[var(--sura-text-primary)]">
            {ar.errorBoundaryTitle}
          </h1>
          <p className="text-[var(--sura-text-body)] text-[var(--sura-text-secondary)]">{ar.errorBoundaryDesc}</p>
          <details className="w-full text-start">
            <summary className="cursor-pointer text-[var(--sura-text-caption)] text-[var(--sura-text-tertiary)]">
              {ar.errorBoundaryDetails}
            </summary>
            <pre
              dir="ltr"
              className="mt-2 overflow-x-auto rounded-[var(--sura-radius-sm)] bg-[var(--sura-surface-secondary)] p-2 text-[var(--sura-text-caption)] text-[var(--sura-text-secondary)]"
            >
              {error.message}
            </pre>
          </details>
          <Button onClick={this.reload}>{ar.errorBoundaryReload}</Button>
        </div>
      </div>
    );
  }
}
