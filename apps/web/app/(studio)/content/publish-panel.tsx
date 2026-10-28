'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

type Page = {
  id: string;
  displayName: string;
  externalId: string;
  eligible: boolean;
  reason: string | null;
  status: string;
};
type Publication = {
  id: string;
  requestId: string;
  pageName: string;
  pageId: string;
  textSnapshot: string;
  status: string;
  providerPostId: string | null;
  errorCode: string | null;
  reconciledAt: string | null;
  createdAt: string;
};
async function json(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(
      typeof data.message === 'string'
        ? data.message
        : 'Publication request failed',
    );
  return data;
}
export function PublishPanel({
  contentId,
  brandId,
  savedBody,
  dirty,
  disabled,
}: {
  contentId: string;
  brandId: string;
  savedBody: string;
  dirty: boolean;
  disabled: boolean;
}) {
  const [pages, setPages] = useState<Page[]>([]);
  const [history, setHistory] = useState<Publication[]>([]);
  const [selected, setSelected] = useState('');
  const [review, setReview] = useState<Publication | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(false);
  const pendingRequestId = useRef<string | null>(null);
  const reload = useCallback(async () => {
    const [readiness, records] = await Promise.all([
      json(`/api/contents/${contentId}/facebook-publications/readiness`),
      json(`/api/contents/${contentId}/facebook-publications`),
    ]);
    setPages(readiness.pages as Page[]);
    setHistory(records.publications as Publication[]);
  }, [contentId]);
  useEffect(() => {
    void Promise.resolve()
      .then(reload)
      .catch(() => setError('Facebook Page readiness is unavailable.'));
  }, [reload]);
  useEffect(() => {
    if (review?.status !== 'PUBLISHING') return;
    const timer = window.setInterval(() => {
      void json(`/api/facebook-publications/${review.id}`)
        .then((result) => {
          const next = result.publication as Publication;
          setReview(next);
          if (next.status !== 'PUBLISHING')
            void reload().catch(() => undefined);
        })
        .catch(() =>
          setError('Publication status is temporarily unavailable.'),
        );
    }, 3000);
    return () => window.clearInterval(timer);
  }, [review?.id, review?.status, reload]);
  async function prepare() {
    if (active.current || !selected || dirty || !savedBody.trim()) return;
    active.current = true;
    pendingRequestId.current ??= crypto.randomUUID();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await json(
        `/api/contents/${contentId}/facebook-publications`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            socialAccountId: selected,
            requestId: pendingRequestId.current,
          }),
        },
      );
      setReview(result.publication as Publication);
      pendingRequestId.current = null;
      setNotice('Review the exact saved text and Page before publishing.');
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not prepare publication.',
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (active.current || !review || review.status !== 'READY' || dirty) return;
    active.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await json(
        `/api/facebook-publications/${review.id}/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        },
      );
      const next = result.publication as Publication;
      setReview(next);
      setNotice(
        next.status === 'PUBLISHED'
          ? 'Facebook returned a Page post ID.'
          : next.status === 'UNCERTAIN'
            ? 'Outcome uncertain. Do not send this text again until reconciled.'
            : next.status === 'FAILED'
              ? 'Facebook rejected the post. Review the connection before another attempt.'
              : 'Checking publication status.',
      );
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to confirm publication. Check history before trying again.',
      );
      // A transport failure after confirmation may still have reached Meta. Preserve the intent.
      void json(`/api/facebook-publications/${review.id}`)
        .then((result) => setReview(result.publication as Publication))
        .catch(() => undefined);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="brand-form-card" aria-labelledby="publish-title">
      <h2 id="publish-title">Publish to Facebook Page</h2>
      <p>
        Only saved draft text can be published. Publishing makes the post
        visible on the selected Facebook Page.
      </p>
      {dirty && (
        <p role="alert">
          Save or discard your editor changes before reviewing a publication.
        </p>
      )}
      {!savedBody.trim() && <p>Write and save a non-empty draft body first.</p>}
      <label htmlFor="publish-page">Destination Facebook Page</label>
      <select
        id="publish-page"
        value={selected}
        onChange={(event) => {
          setSelected(event.target.value);
          pendingRequestId.current = null;
          setReview(null);
        }}
        disabled={busy || disabled}
      >
        <option value="">Select a connected Page</option>
        {pages.map((page) => (
          <option key={page.id} value={page.id} disabled={!page.eligible}>
            {page.displayName}{' '}
            {page.eligible ? '' : `— ${page.reason ?? page.status}`}
          </option>
        ))}
      </select>
      {pages.length === 0 && (
        <p>No Facebook Page is connected to this brand.</p>
      )}
      {pages.some((page) => !page.eligible) && (
        <p>
          <Link href={`/brands/${brandId}/social-accounts`}>
            Reconnect with publishing permission
          </Link>{' '}
          for Pages that are not ready.
        </p>
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={busy || disabled || dirty || !selected || !savedBody.trim()}
        onClick={() => void prepare()}
      >
        Review saved text
      </button>
      {review && (
        <div className="publish-review">
          <h3>
            {review.status === 'READY'
              ? 'Confirm exact publication'
              : 'Publication result'}
          </h3>
          <p>
            <strong>Facebook Page:</strong> {review.pageName}
          </p>
          <p>
            <strong>Text to publish:</strong>
          </p>
          <pre className="publish-text">{review.textSnapshot}</pre>
          <p>
            Status: {review.status}
            {review.errorCode ? ` · ${review.errorCode}` : ''}
            {review.reconciledAt ? ' · reconciled by operator' : ''}
          </p>
          {review.providerPostId && (
            <p>Facebook post ID: {review.providerPostId}</p>
          )}
          {review.status === 'READY' && (
            <button
              type="button"
              className="button"
              disabled={
                busy || disabled || dirty || review.textSnapshot !== savedBody
              }
              onClick={() => void confirm()}
            >
              {busy ? 'Publishing…' : 'Publish to Facebook'}
            </button>
          )}
          {review.status === 'READY' && review.textSnapshot !== savedBody && (
            <p role="alert">Draft text changed. Review it again.</p>
          )}
        </div>
      )}
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
      <h3>Publication history</h3>
      {history.length === 0 ? (
        <p>No Facebook publications for this draft yet.</p>
      ) : (
        <ul className="social-list">
          {history.map((item) => (
            <li key={item.id}>
              <strong>{item.pageName}</strong> · {item.status} ·{' '}
              {new Date(item.createdAt).toLocaleString()}
              {item.providerPostId ? ` · ${item.providerPostId}` : ''}
              {item.status === 'UNCERTAIN' && (
                <p>Do not retry until the outcome is reconciled.</p>
              )}
              <button
                type="button"
                className="secondary-button"
                onClick={() => setReview(item)}
              >
                Inspect snapshot
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
