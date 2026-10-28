'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';

type Member = {
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
  kind: 'TEXT' | 'IMAGE';
  mediaAssetId: string | null;
  status: string;
  providerPostId: string | null;
  errorCode: string | null;
  reconciledAt: string | null;
  createdAt: string;
};
type Photo = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
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
export function LinkedInPublishPanel({
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
  const [members, setMembers] = useState<Member[]>([]);
  const [history, setHistory] = useState<Publication[]>([]);
  const [selected, setSelected] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState('');
  const [review, setReview] = useState<Publication | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(false);
  const pendingRequestId = useRef<string | null>(null);
  const reload = useCallback(async () => {
    const [readiness, records, media] = await Promise.all([
      json(`/api/contents/${contentId}/linkedin-publications/readiness`),
      json(`/api/contents/${contentId}/linkedin-publications`),
      json(`/api/brands/${brandId}/media`),
    ]);
    setMembers(readiness.members as Member[]);
    setHistory(records.publications as Publication[]);
    setPhotos(
      ((media.assets ?? media.media ?? media) as Photo[]).filter(
        (asset) =>
          ['image/jpeg', 'image/png'].includes(asset.mimeType) &&
          asset.sizeBytes <= 10_000_000,
      ),
    );
  }, [contentId, brandId]);
  useEffect(() => {
    void Promise.resolve()
      .then(reload)
      .catch(() => setError('LinkedIn member readiness is unavailable.'));
  }, [reload]);
  useEffect(() => {
    if (review?.status !== 'PUBLISHING') return;
    const timer = window.setInterval(() => {
      void json(`/api/linkedin-publications/${review.id}`)
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
        `/api/contents/${contentId}/linkedin-publications`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            socialAccountId: selected,
            requestId: pendingRequestId.current,
            ...(selectedPhoto ? { mediaAssetId: selectedPhoto } : {}),
          }),
        },
      );
      setReview(result.publication as Publication);
      pendingRequestId.current = null;
      setNotice(
        'Review the exact saved text, image and member before publishing.',
      );
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
        `/api/linkedin-publications/${review.id}/confirm`,
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
          ? 'LinkedIn returned a Member post ID.'
          : next.status === 'UNCERTAIN'
            ? 'Outcome uncertain. Do not publish this snapshot again until reconciled.'
            : next.status === 'FAILED'
              ? 'LinkedIn rejected the post. Review the connection before another attempt.'
              : 'Checking publication status.',
      );
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to confirm publication. Check history before trying again.',
      );
      // A transport failure after confirmation may still have reached LinkedIn. Preserve the intent.
      void json(`/api/linkedin-publications/${review.id}`)
        .then((result) => setReview(result.publication as Publication))
        .catch(() => undefined);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="brand-form-card"
      aria-labelledby="linkedin-publish-title"
    >
      <h2 id="linkedin-publish-title">Publish to LinkedIn member</h2>
      <p>
        Only saved draft text and one optional brand JPEG/PNG can be published.
        LinkedIn product entitlement must also permit the Posts API. Publishing
        makes the post visible on the selected LinkedIn member.
      </p>
      {dirty && (
        <p role="alert">
          Save or discard your editor changes before reviewing a publication.
        </p>
      )}
      {!savedBody.trim() && <p>Write and save a non-empty draft body first.</p>}
      <label htmlFor="linkedin-publish-member">
        Destination LinkedIn member
      </label>
      <select
        id="linkedin-publish-member"
        value={selected}
        onChange={(event) => {
          setSelected(event.target.value);
          pendingRequestId.current = null;
          setReview(null);
        }}
        disabled={busy || disabled}
      >
        <option value="">Select a connected member</option>
        {members.map((member) => (
          <option key={member.id} value={member.id} disabled={!member.eligible}>
            {member.displayName}{' '}
            {member.eligible ? '' : `— ${member.reason ?? member.status}`}
          </option>
        ))}
      </select>
      {members.length === 0 && (
        <p>No LinkedIn member is connected to this brand.</p>
      )}
      {members.some((member) => !member.eligible) && (
        <p>
          <Link href={`/brands/${brandId}/social-accounts`}>
            Reconnect with publishing permission
          </Link>{' '}
          for members that are not ready.
        </p>
      )}
      <label htmlFor="linkedin-publish-photo">Single photo (optional)</label>
      <select
        id="linkedin-publish-photo"
        value={selectedPhoto}
        disabled={busy || disabled}
        onChange={(event) => {
          setSelectedPhoto(event.target.value);
          pendingRequestId.current = null;
          setReview(null);
        }}
      >
        <option value="">Text only</option>
        {photos.map((photo) => (
          <option key={photo.id} value={photo.id}>
            {photo.originalFilename}
          </option>
        ))}
      </select>
      {selectedPhoto && (
        <Image
          alt="Selected private brand photo"
          className="publish-photo-preview"
          src={`/api/media/${selectedPhoto}/file`}
          width={320}
          height={320}
          unoptimized
        />
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={busy || disabled || dirty || !selected || !savedBody.trim()}
        onClick={() => void prepare()}
      >
        Review saved {selectedPhoto ? 'text and photo' : 'text'}
      </button>
      {review && (
        <div className="publish-review">
          <h3>
            {review.status === 'READY'
              ? 'Confirm exact publication'
              : 'Publication result'}
          </h3>
          <p>
            <strong>LinkedIn member:</strong> {review.pageName}
          </p>
          <p>
            <strong>Text to publish:</strong>
          </p>
          <pre className="publish-text">{review.textSnapshot}</pre>
          {review.kind === 'IMAGE' && review.mediaAssetId && (
            <div>
              <p>
                <strong>Single photo:</strong> private brand media
              </p>
              <Image
                alt="Photo selected for LinkedIn member post"
                className="publish-photo-preview"
                src={`/api/media/${review.mediaAssetId}/file`}
                width={320}
                height={320}
                unoptimized
              />
            </div>
          )}
          <p>
            Status: {review.status}
            {review.errorCode ? ` · ${review.errorCode}` : ''}
            {review.reconciledAt ? ' · reconciled by operator' : ''}
          </p>
          {review.providerPostId && (
            <p>LinkedIn post ID: {review.providerPostId}</p>
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
              {busy
                ? 'Publishing…'
                : review.kind === 'IMAGE'
                  ? 'Publish image to LinkedIn'
                  : 'Publish to LinkedIn'}
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
        <p>No LinkedIn publications for this draft yet.</p>
      ) : (
        <ul className="social-list">
          {history.map((item) => (
            <li key={item.id}>
              <strong>{item.pageName}</strong> ·{' '}
              {item.kind === 'IMAGE' ? 'Photo' : 'Text'} · {item.status} ·{' '}
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
