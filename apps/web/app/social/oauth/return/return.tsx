'use client';

import { useEffect } from 'react';

export function OAuthReturn({ destination }: { destination: string }) {
  useEffect(() => {
    // A browser-initiated same-origin navigation sends the Strict session
    // cookie after the cross-site OAuth callback has landed.
    window.location.replace(destination);
  }, [destination]);

  return (
    <section className="brand-form-card">
      <h1>Returning to SYNVARO</h1>
      <p>Opening your social account connection…</p>
      <p>
        <a href={destination}>Continue to social accounts</a>
      </p>
    </section>
  );
}
