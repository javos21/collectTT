import type { ReactNode } from 'react';
import Link from 'next/link';

interface AuthShellProps {
  children: ReactNode;
}

export function AuthShell({ children }: AuthShellProps) {
  return (
    <main className="auth-page" id="main-content">
      <aside className="auth-context" aria-label="CollectTT account access">
        <div>
          <Link className="auth-brand" href="/" aria-label="CollectTT home">
            <img className="auth-logo" src="/assets/collecttt_logo.png" alt="CollectTT" />
          </Link>
          <div className="auth-context__title">Your collection, in one place.</div>
        </div>

        <div>
          <a className="auth-powered-by" href="https://www.chaconialabs.com" target="_blank" rel="noreferrer">
            <span>Powered by</span>
            <img src="/assets/chaconia-labs-lockup.png" alt="Chaconia Labs" />
          </a>
        </div>
      </aside>
      {children}
    </main>
  );
}
