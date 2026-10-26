'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function Logout() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error();
      router.replace('/login');
      router.refresh();
    } catch {
      setError('Sign out failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="logout-button" onClick={logout} disabled={busy}>
        Log out
      </button>
      <span role="status">{error}</span>
    </div>
  );
}
