'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MfaPage() {
  const router = useRouter();
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    fetch('/api/auth/mfa/status', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          router.replace('/login');
          return;
        }
        setSetupRequired(
          ((await response.json()) as { setupRequired: boolean }).setupRequired,
        );
      })
      .catch(() => setMessage('Unable to check the MFA session.'));
  }, [router]);
  async function call(
    action: 'setup' | 'activate' | 'verify',
    body: object = {},
  ) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/auth/mfa/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        message?: string;
        secret?: string;
        recoveryCodes?: string[];
      };
      if (!response.ok) {
        setMessage(result.message ?? 'Verification failed.');
        return;
      }
      if (action === 'setup') setSecret(result.secret ?? '');
      else if (action === 'activate') {
        setRecoveryCodes(result.recoveryCodes ?? []);
        setSecret('');
        setCode('');
      } else {
        router.replace('/');
        router.refresh();
      }
    } catch {
      setMessage('Unable to connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-card">
      <p className="eyebrow">SYNVARO STUDIO</p>
      <h1>Two-step verification</h1>
      {recoveryCodes.length ? (
        <>
          <p>
            Save these one-time recovery codes in a safe place. They will not be
            shown again.
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {recoveryCodes.join('\n')}
          </pre>
          <button
            className="button"
            onClick={() => {
              router.replace('/');
              router.refresh();
            }}
          >
            I saved the codes
          </button>
        </>
      ) : setupRequired === null ? (
        <p>Checking your sign-in…</p>
      ) : (
        <>
          {setupRequired ? (
            <>
              <p>Set up an authenticator app before entering the Studio.</p>
              {!secret ? (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => call('setup')}
                >
                  Start setup
                </button>
              ) : (
                <>
                  <p>
                    In your authenticator app, add an account manually with this
                    secret (time-based, six digits, 30 seconds):
                  </p>
                  <code style={{ overflowWrap: 'anywhere' }}>{secret}</code>
                </>
              )}
            </>
          ) : (
            <p>
              Enter a six-digit authenticator code or a saved recovery code.
            </p>
          )}
          {(!setupRequired || secret) && (
            <form
              method="post"
              onSubmit={(event) => {
                event.preventDefault();
                void call(setupRequired ? 'activate' : 'verify', { code });
              }}
            >
              <label htmlFor="mfa-code">Verification code</label>
              <input
                id="mfa-code"
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.trim().toLowerCase())
                }
                autoComplete="one-time-code"
                maxLength={32}
                required
              />
              <button className="button" disabled={busy}>
                {busy
                  ? 'Checking…'
                  : setupRequired
                    ? 'Confirm setup'
                    : 'Verify and sign in'}
              </button>
            </form>
          )}
        </>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
