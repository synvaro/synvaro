'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Platform = 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN' | 'YOUTUBE';
type Provider = {
  platform: Platform;
  provider: string;
  status: 'AVAILABLE' | 'NOT_CONFIGURED';
  accountType: string;
  publishingEligible: boolean;
};
type Account = {
  id: string;
  platform: Platform;
  displayName: string;
  accountType: string;
  status: string;
  scopes: string[];
  accessExpiresAt: string | null;
  lastValidatedAt: string | null;
  publishingEligible: boolean;
};
type Candidate = {
  platform: Platform;
  externalId: string;
  displayName: string;
  accountType: string;
  scopes: string[];
};
type Attempt = {
  id: string;
  brandId: string;
  platform: Platform;
  status: string;
  errorCode: string | null;
  accounts: Candidate[];
};

async function json(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(
      typeof data.message === 'string' ? data.message : 'Request failed',
    );
  return data;
}

export function SocialAccounts({
  brandId,
  brandName,
  attemptId,
}: {
  brandId: string;
  brandName: string;
  attemptId?: string;
}) {
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reload = useCallback(async () => {
    const [catalog, existing] = await Promise.all([
      json('/api/social/providers'),
      json(`/api/brands/${brandId}/social-accounts`),
    ]);
    setProviders(catalog.providers as Provider[]);
    setAccounts(existing.accounts as Account[]);
  }, [brandId]);
  useEffect(() => {
    void Promise.resolve()
      .then(reload)
      .catch(() => setError('Connection information is unavailable.'));
  }, [reload]);
  useEffect(() => {
    if (!attemptId || !/^[0-9a-f-]{36}$/i.test(attemptId)) return;
    void json(`/api/social/oauth/attempts/${attemptId}`)
      .then((result) => {
        const discovered = result as unknown as Attempt;
        if (discovered.brandId === brandId) setAttempt(discovered);
      })
      .catch(() =>
        setError('The authorization could not be resumed in this session.'),
      );
  }, [attemptId, brandId]);

  async function start(platform: Platform) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await json(`/api/brands/${brandId}/social/oauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      const authorizationUrl = result.authorizationUrl;
      if (
        typeof authorizationUrl !== 'string' ||
        !authorizationUrl.startsWith('https://')
      )
        throw new Error('Authorization URL is unavailable');
      window.location.assign(authorizationUrl);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not start authorization',
      );
      setBusy(false);
    }
  }
  async function associate(externalId: string) {
    if (!attempt) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await json(`/api/social/oauth/attempts/${attempt.id}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalId }),
      });
      await reload();
      setNotice('Account connected to this brand.');
      setAttempt(null);
      router.replace(`/brands/${brandId}/social-accounts`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not connect account',
      );
    } finally {
      setBusy(false);
    }
  }
  async function disconnect(id: string) {
    if (!window.confirm('Disconnect this account from this brand?')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await json(`/api/social/accounts/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      await reload();
      setNotice(
        result.providerRevocationConfirmed
          ? 'Account disconnected and provider access revoked.'
          : 'Account disconnected locally. Review provider app access to revoke it there.',
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not disconnect account',
      );
    } finally {
      setBusy(false);
    }
  }
  async function refresh(id: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await json(`/api/social/accounts/${id}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      await reload();
      setNotice('YouTube connection refreshed.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not refresh connection',
      );
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="social-workspace">
      <p className="eyebrow">{brandName}</p>
      <h1>Social accounts</h1>
      <p>
        Connect a platform account to this brand. Connecting does not enable
        publishing.
      </p>
      <p>
        <Link className="auth-link" href="/brands">
          Back to brands
        </Link>
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="form-notice">
          {notice}
        </p>
      )}
      {attempt && (
        <section className="brand-form-card">
          <h2>Choose an account for {brandName}</h2>
          {attempt.status === 'READY' && attempt.accounts.length === 0 && (
            <p>
              No eligible accounts were returned. Check platform permissions and
              account type.
            </p>
          )}
          {attempt.status !== 'READY' && (
            <p>
              Authorization status: {attempt.status}. {attempt.errorCode ?? ''}
            </p>
          )}
          {attempt.status === 'READY' && (
            <ul className="social-list">
              {attempt.accounts.map((candidate) => (
                <li key={candidate.externalId}>
                  <strong>{candidate.displayName}</strong> ·{' '}
                  {candidate.accountType} ({candidate.platform})
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void associate(candidate.externalId)}
                  >
                    Connect to {brandName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="brand-form-card">
        <h2>Available platforms</h2>
        <div className="social-grid">
          {providers.map((provider) => (
            <article className="brand-card" key={provider.platform}>
              <h3>
                {provider.platform === 'YOUTUBE'
                  ? 'YouTube'
                  : provider.platform === 'LINKEDIN'
                    ? 'LinkedIn'
                    : provider.platform === 'INSTAGRAM'
                      ? 'Instagram'
                      : 'Facebook'}
              </h3>
              <p>
                {provider.accountType.toLowerCase()} ·{' '}
                {provider.status === 'AVAILABLE'
                  ? 'Locally configured'
                  : 'App configuration required'}
              </p>
              <p>
                Provider consent and account eligibility are checked during
                authorization. Publishing access is not requested.
              </p>
              <button
                className="button"
                disabled={busy || provider.status !== 'AVAILABLE'}
                onClick={() => void start(provider.platform)}
              >
                Connect
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="brand-form-card">
        <h2>Connected to {brandName}</h2>
        {accounts.length === 0 && <p>No social accounts connected yet.</p>}
        <ul className="social-list">
          {accounts.map((account) => (
            <li key={account.id}>
              <strong>{account.displayName}</strong> · {account.platform}{' '}
              {account.accountType}
              <p>
                Status: {account.status}. Last validated:{' '}
                {account.lastValidatedAt
                  ? new Date(account.lastValidatedAt).toLocaleString()
                  : 'Never'}
                .
              </p>
              <p>
                Provider-reported scopes:{' '}
                {account.scopes.join(', ') || 'Not reported'}. Publishing
                eligibility has not been verified.
              </p>
              <div className="form-actions">
                {account.platform === 'YOUTUBE' &&
                  account.status !== 'CONNECTED' && (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void refresh(account.id)}
                    >
                      Refresh token
                    </button>
                  )}
                {account.status !== 'CONNECTED' && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void start(account.platform)}
                  >
                    Reauthorize
                  </button>
                )}
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void disconnect(account.id)}
                >
                  Disconnect
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
