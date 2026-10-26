import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Navigation } from './navigation';
import './globals.css';

export const metadata: Metadata = {
  title: 'SYNVARO — Content Studio',
  description: 'Open-source AI content studio. Create. Orchestrate. Publish.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="studio">
          <aside className="sidebar">
            <Link href="/" className="identity" aria-label="SYNVARO home">
              <span className="mark" aria-hidden="true">
                S
              </span>
              SYNVARO
            </Link>
            <p className="tagline">Create. Orchestrate. Publish.</p>
            <Navigation />
            <div className="sidebar-note">
              <span className="status-dot" />
              Foundation preview
            </div>
          </aside>
          <div className="workspace">
            <header className="topbar">
              <span>Content Studio</span>
              <span className="badge">Community · Open source</span>
            </header>
            <main id="main">{children}</main>
            <footer>
              Built for thoughtful content. Powered by human decisions.
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
