'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
type Account = {
  id: string;
  displayName: string;
  externalId: string;
  eligible: boolean;
  reason: string | null;
  status: string;
};
type Photo = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
};
type Publication = {
  id: string;
  pageName: string;
  textSnapshot: string;
  mediaAssetId: string;
  status: string;
  providerContainerId: string | null;
  containerStatus: string | null;
  providerPostId: string | null;
  errorCode: string | null;
  createdAt: string;
};
async function json(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(
      typeof data.message === 'string'
        ? data.message
        : 'Instagram request failed',
    );
  return data;
}
export function InstagramPublishPanel({
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [history, setHistory] = useState<Publication[]>([]);
  const [accountId, setAccountId] = useState('');
  const [mediaId, setMediaId] = useState('');
  const [review, setReview] = useState<Publication | null>(null);
  const [delivery, setDelivery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const active = useRef(false);
  const requestId = useRef<string | null>(null);
  const reload = useCallback(async () => {
    const [ready, records, media] = await Promise.all([
      json(`/api/contents/${contentId}/instagram-publications/readiness`),
      json(`/api/contents/${contentId}/instagram-publications`),
      json(`/api/brands/${brandId}/media`),
    ]);
    setAccounts(ready.accounts as Account[]);
    setDelivery(ready.deliveryConfigured as boolean);
    const assets = (media.assets ?? media.media ?? media) as Photo[];
    setPhotos(
      assets.filter(
        (item) =>
          item.mimeType === 'image/jpeg' &&
          item.sizeBytes <= 8_000_000 &&
          item.width > 0 &&
          item.height > 0 &&
          item.width / item.height >= 0.8 &&
          item.width / item.height <= 1.91,
      ),
    );
    const next = records.publications as Publication[];
    setHistory(next);
    setReview((current) =>
      current
        ? (next.find((item) => item.id === current.id) ?? current)
        : (next.find((item) =>
            ['READY', 'PROCESSING', 'PUBLISHING', 'UNCERTAIN'].includes(
              item.status,
            ),
          ) ?? null),
    );
  }, [brandId, contentId]);
  useEffect(() => {
    void Promise.resolve()
      .then(reload)
      .catch(() => setError('Instagram readiness is unavailable.'));
  }, [reload]);
  useEffect(() => {
    if (review?.status !== 'PROCESSING' && review?.status !== 'PUBLISHING')
      return;
    const timer = window.setInterval(() => {
      void json(`/api/instagram-publications/${review.id}`)
        .then((result) => {
          const next = result.publication as Publication;
          setReview(next);
          if (next.status !== 'PROCESSING' && next.status !== 'PUBLISHING')
            void reload().catch(() => undefined);
        })
        .catch(() => setError('Status is temporarily unavailable.'));
    }, 4000);
    return () => window.clearInterval(timer);
  }, [review?.id, review?.status, reload]);
  async function run(action: () => Promise<Publication>, success: string) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      setReview(result);
      setMessage(success);
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Request failed; check history before trying again.',
      );
      await reload().catch(() => undefined);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  const post = async (path: string, body: unknown) =>
    (
      await json(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).publication as Publication;
  const selectedPhoto = photos.find((item) => item.id === mediaId);
  return (
    <section
      className="brand-form-card"
      aria-labelledby="instagram-publish-title"
    >
      <h2 id="instagram-publish-title">Publish one image to Instagram</h2>
      <p>
        Professional accounts only. This publishes the exact saved caption and
        JPEG to the selected Instagram account. It becomes publicly visible
        after final confirmation.
      </p>
      {dirty && (
        <p role="alert">
          Save or discard draft edits before preparing a publication.
        </p>
      )}
      {!delivery && (
        <p role="alert">
          Public HTTPS image delivery is not configured. Publishing is
          unavailable.
        </p>
      )}
      <label htmlFor="instagram-account">Destination Instagram account</label>
      <select
        id="instagram-account"
        value={accountId}
        disabled={busy || disabled}
        onChange={(event) => {
          setAccountId(event.target.value);
          setReview(null);
          requestId.current = null;
        }}
      >
        <option value="">Select an account</option>
        {accounts.map((account) => (
          <option
            key={account.id}
            value={account.id}
            disabled={!account.eligible}
          >
            {account.displayName}
            {account.eligible ? '' : ` — ${account.reason ?? account.status}`}
          </option>
        ))}
      </select>
      {accounts.length === 0 && (
        <p>No professional Instagram account is connected to this brand.</p>
      )}
      {accounts.some((account) => !account.eligible) && (
        <p>
          <Link href={`/brands/${brandId}/social-accounts`}>
            Reconnect Instagram with publishing permission
          </Link>
          .
        </p>
      )}
      <label htmlFor="instagram-photo">Brand JPEG image</label>
      <select
        id="instagram-photo"
        value={mediaId}
        disabled={busy || disabled}
        onChange={(event) => {
          setMediaId(event.target.value);
          setReview(null);
          requestId.current = null;
        }}
      >
        <option value="">Select one JPEG</option>
        {photos.map((photo) => (
          <option key={photo.id} value={photo.id}>
            {photo.originalFilename}
          </option>
        ))}
      </select>
      {selectedPhoto && (
        <Image
          alt="Selected private brand image"
          className="publish-photo-preview"
          src={`/api/media/${selectedPhoto.id}/file`}
          width={320}
          height={320}
          unoptimized
        />
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={
          busy ||
          disabled ||
          dirty ||
          !delivery ||
          !accountId ||
          !mediaId ||
          !savedBody.trim() ||
          savedBody.length > 2200
        }
        onClick={() =>
          void run(async () => {
            requestId.current ??= crypto.randomUUID();
            const result = await post(
              `/api/contents/${contentId}/instagram-publications`,
              {
                socialAccountId: accountId,
                mediaAssetId: mediaId,
                requestId: requestId.current,
              },
            );
            requestId.current = null;
            return result;
          }, 'Review this exact saved caption, account and image before confirming.')
        }
      >
        Review Instagram publication
      </button>
      {review && (
        <div className="publish-review">
          <h3>Publication {review.status === 'READY' ? 'review' : 'status'}</h3>
          <p>
            <strong>Instagram account:</strong> {review.pageName}
          </p>
          <p>
            <strong>Exact caption:</strong>
          </p>
          <pre className="publish-text">{review.textSnapshot}</pre>
          <Image
            alt="Reviewed brand image"
            className="publish-photo-preview"
            src={`/api/media/${review.mediaAssetId}/file`}
            width={320}
            height={320}
            unoptimized
          />
          <p>
            Status: {review.status}
            {review.containerStatus
              ? ` · container ${review.containerStatus}`
              : ''}
            {review.errorCode ? ` · ${review.errorCode}` : ''}
          </p>
          {review.providerPostId && (
            <p>Verified Instagram media ID: {review.providerPostId}</p>
          )}
          {review.status === 'READY' && (
            <button
              type="button"
              className="button"
              disabled={
                busy || disabled || dirty || review.textSnapshot !== savedBody
              }
              onClick={() =>
                void run(
                  () =>
                    post(`/api/instagram-publications/${review.id}/confirm`, {
                      confirm: true,
                    }),
                  'Container requested once. Check its processing status before the final publish action.',
                )
              }
            >
              Confirm image delivery to Instagram
            </button>
          )}
          {review.status === 'PROCESSING' && (
            <>
              {(dirty || review.textSnapshot !== savedBody) && (
                <p role="alert">
                  Draft changed. This container cannot be published without
                  reviewing the saved caption again.
                </p>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={busy || disabled}
                onClick={() =>
                  void run(
                    () =>
                      post(`/api/instagram-publications/${review.id}/check`, {
                        confirm: true,
                      }),
                    'Container status checked; this did not publish.',
                  )
                }
              >
                Check container status
              </button>
              {review.containerStatus === 'FINISHED' && (
                <button
                  type="button"
                  className="button"
                  disabled={
                    busy ||
                    disabled ||
                    dirty ||
                    review.textSnapshot !== savedBody
                  }
                  onClick={() =>
                    void run(
                      () =>
                        post(
                          `/api/instagram-publications/${review.id}/publish`,
                          { confirm: true },
                        ),
                      'Final publication attempted once. Inspect the result below.',
                    )
                  }
                >
                  Publish finished image to Instagram
                </button>
              )}
            </>
          )}
          {review.status === 'UNCERTAIN' && (
            <p role="alert">
              Outcome uncertain. Do not repeat this publication until
              reconciled.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="form-notice">
          {message}
        </p>
      )}
      <h3>Instagram publication history</h3>
      {history.length === 0 ? (
        <p>No Instagram publications for this draft yet.</p>
      ) : (
        <ul className="social-list">
          {history.map((item) => (
            <li key={item.id}>
              <strong>{item.pageName}</strong> · {item.status} ·{' '}
              {new Date(item.createdAt).toLocaleString()}{' '}
              {item.providerPostId ? ` · ${item.providerPostId}` : ''}
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
