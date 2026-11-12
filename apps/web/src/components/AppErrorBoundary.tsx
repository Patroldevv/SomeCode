import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n/index.ts';

/**
 * Without this, one error while drawing anything makes React remove the whole interface and leave a bare dark
 * page. This shows what happened and a way back instead.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('SomeCode: the interface crashed', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6 text-center font-ui text-text">
        <h1 className="text-xl font-semibold">{t('crash.title')}</h1>
        <p className="max-w-md text-sm text-text-muted">{t('crash.hint')}</p>
        <pre className="max-h-40 max-w-xl overflow-auto rounded-lg bg-bg-subtle p-3 text-left text-xs text-text-muted">{error.message}</pre>
        <div className="flex gap-2">
          <button type="button" className="question-submit" onClick={() => location.reload()}>
            {t('crash.reload')}
          </button>
          <button type="button" className="question-skip" onClick={() => this.setState({ error: null })}>
            {t('crash.retry')}
          </button>
        </div>
      </div>
    );
  }
}
