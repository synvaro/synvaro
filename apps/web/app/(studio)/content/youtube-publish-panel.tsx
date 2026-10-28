'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

type Channel = {
  id: string;
  displayName: string;
  eligible: boolean;
  reason: string | null;
};
type Asset = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  origin: string;
};
type Publication = {
  id: string;
  pageName: string;
  pageId: string;
  textSnapshot: string;
  youtubeTitle: string;
  youtubePrivacy: 'private' | 'unlisted' | 'public';
  youtubeUploadedBytes: number;
  mediaSizeBytes: number;
  mediaAssetId: string;
  shortsEligible: boolean;
  status: string;
  providerPostId: string | null;
  youtubeProcessingStatus: string | null;
  watchUrl: string | null;
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
        : 'YouTube request failed',
    );
  return data;
}
export function YouTubePublishPanel({
  contentId,
  brandId,
  savedTitle,
  dirty,
  disabled,
}: {
  contentId: string;
  brandId: string;
  savedTitle: string;
  dirty: boolean;
  disabled: boolean;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [history, setHistory] = useState<Publication[]>([]);
  const [channel, setChannel] = useState('');
  const [asset, setAsset] = useState('');
  const [title, setTitle] = useState(savedTitle);
  const [privacy, setPrivacy] = useState<'private' | 'unlisted' | 'public'>(
    'private',
  );
  const [review, setReview] = useState<Publication | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(false);
  const pendingRequestId = useRef<string | null>(null);
  const reload = useCallback(async () => {
    const [readiness, records, media] = await Promise.all([
      json(`/api/contents/${contentId}/youtube-publications/readiness`),
      json(`/api/contents/${contentId}/youtube-publications`),
      json(`/api/brands/${brandId}/media`),
    ]);
    setChannels(readiness.channels as Channel[]);
    setHistory(records.publications as Publication[]);
    setAssets(
      ((media.assets ?? []) as Asset[]).filter(
        (item) =>
          item.mimeType === 'video/mp4' && item.sizeBytes <= 20 * 1024 * 1024,
      ),
    );
  }, [contentId, brandId]);
  useEffect(() => {
    void Promise.resolve()
      .then(reload)
      .catch(() => setError('YouTube readiness is unavailable.'));
  }, [reload]);
  useEffect(() => {
    if (review?.status !== 'PUBLISHING') return;
    const timer = window.setInterval(() => {
      void json(`/api/youtube-publications/${review.id}`)
        .then((result) => {
          const next = result.publication as Publication;
          setReview(next);
          if (next.status !== 'PUBLISHING')
            void reload().catch(() => undefined);
        })
        .catch(() => setError('Upload status is temporarily unavailable.'));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [review?.id, review?.status, reload]);
  async function prepare() {
    if (active.current || !channel || !asset || dirty || !title.trim()) return;
    active.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    pendingRequestId.current ??= crypto.randomUUID();
    try {
      const result = await json(
        `/api/contents/${contentId}/youtube-publications`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            socialAccountId: channel,
            mediaAssetId: asset,
            requestId: pendingRequestId.current,
            title,
            privacy,
          }),
        },
      );
      setReview(result.publication as Publication);
      pendingRequestId.current = null;
      setNotice(
        'Review the exact saved description, title, channel, video and visibility before upload.',
      );
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not prepare YouTube upload.',
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  async function action(kind: 'confirm' | 'resume' | 'check') {
    if (active.current || !review || dirty) return;
    active.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await json(
        `/api/youtube-publications/${review.id}/${kind}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(kind === 'check' ? {} : { confirm: true }),
        },
      );
      const next = result.publication as Publication;
      setReview(next);
      setNotice(
        next.status === 'PUBLISHED'
          ? 'YouTube verified the video ID and processing status.'
          : next.status === 'PROCESSING'
            ? 'Upload accepted; YouTube is still processing.'
            : next.status === 'UNCERTAIN'
              ? 'Outcome uncertain. Check or continue only this session; do not start a new upload.'
              : next.status === 'FAILED'
                ? 'YouTube rejected or failed the upload.'
                : 'Upload in progress.',
      );
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Upload status unavailable. Do not start a new upload.',
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  const chosen = assets.find((item) => item.id === asset);
  const likelyShort =
    chosen &&
    chosen.width &&
    chosen.height &&
    chosen.durationMs &&
    chosen.width <= chosen.height &&
    chosen.durationMs <= 180_000;
  return (
    <section
      className="brand-form-card"
      aria-labelledby="youtube-publish-title"
    >
      <h2 id="youtube-publish-title">Upload to YouTube</h2>
      <p>
        One saved brand video or Reel. Saving this draft never uploads. YouTube
        decides whether a square or vertical video up to three minutes is a
        Short; Content ID, copyright and channel rules may affect it.
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
      <label htmlFor="youtube-channel">Destination channel</label>
      <select
        id="youtube-channel"
        value={channel}
        disabled={busy || disabled}
        onChange={(event) => {
          setChannel(event.target.value);
          setReview(null);
          pendingRequestId.current = null;
        }}
      >
        <option value="">Choose a connected channel</option>
        {channels.map((item) => (
          <option key={item.id} value={item.id} disabled={!item.eligible}>
            {item.displayName}
            {item.eligible ? '' : ` — ${item.reason ?? 'Unavailable'}`}
          </option>
        ))}
      </select>
      {channels.length === 0 && (
        <p>No YouTube channel is connected to this brand.</p>
      )}
      {channels.some((item) => !item.eligible) && (
        <p>
          <Link href={`/brands/${brandId}/social-accounts`}>
            Reconnect with YouTube upload permission
          </Link>
        </p>
      )}
      <label htmlFor="youtube-video">Brand video</label>
      <select
        id="youtube-video"
        value={asset}
        disabled={busy || disabled}
        onChange={(event) => {
          setAsset(event.target.value);
          setReview(null);
          pendingRequestId.current = null;
        }}
      >
        <option value="">Choose an MP4</option>
        {assets.map((item) => (
          <option key={item.id} value={item.id}>
            {item.originalFilename}
            {item.origin === 'REEL_ASSEMBLED' ? ' · assembled Reel' : ''}
          </option>
        ))}
      </select>
      {assets.length === 0 && (
        <p>No eligible MP4 exists in this brand’s Media Library.</p>
      )}
      {chosen && (
        <>
          <video
            controls
            preload="metadata"
            src={`/api/media/${chosen.id}/file`}
            className="publish-photo-preview"
            aria-label="Private source video"
          />
          <p>
            {chosen.width}×{chosen.height} ·{' '}
            {chosen.durationMs ? Math.round(chosen.durationMs / 1000) : '?'}{' '}
            seconds · {chosen.sizeBytes.toLocaleString()} bytes.{' '}
            {likelyShort
              ? 'Possibly Shorts-eligible; YouTube decides.'
              : 'Ordinary video or classification unknown.'}
          </p>
        </>
      )}
      <label htmlFor="youtube-title">YouTube title</label>
      <input
        id="youtube-title"
        value={title}
        maxLength={100}
        disabled={busy || disabled}
        onChange={(event) => {
          setTitle(event.target.value);
          setReview(null);
          pendingRequestId.current = null;
        }}
      />
      <label htmlFor="youtube-privacy">Visibility</label>
      <select
        id="youtube-privacy"
        value={privacy}
        disabled={busy || disabled}
        onChange={(event) => {
          setPrivacy(event.target.value as typeof privacy);
          setReview(null);
          pendingRequestId.current = null;
        }}
      >
        <option value="private">Private (default)</option>
        <option value="unlisted">
          Unlisted — anyone with the link may view
        </option>
        <option value="public">Public — visible on YouTube</option>
      </select>
      <p>
        Saved draft body is the description. Unsaved edits are excluded. Public
        and unlisted uploads may become visible when YouTube completes
        processing.
      </p>
      {dirty && (
        <p role="status">
          Save or discard draft edits before reviewing an upload.
        </p>
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={
          busy || disabled || dirty || !channel || !asset || !title.trim()
        }
        onClick={() => void prepare()}
      >
        Review upload
      </button>
      {review && (
        <div className="publish-review">
          <h3>Exact upload review</h3>
          <p>
            <strong>Channel:</strong> {review.pageName} ({review.pageId})
          </p>
          <p>
            <strong>Title:</strong> {review.youtubeTitle}
          </p>
          <p>
            <strong>Visibility:</strong> {review.youtubePrivacy}
          </p>
          <p>
            <strong>Description:</strong>
          </p>
          <pre className="publish-text">{review.textSnapshot}</pre>
          <p>
            <strong>Source:</strong>{' '}
            {assets.find((item) => item.id === review.mediaAssetId)
              ?.originalFilename ?? review.mediaAssetId}{' '}
            ·{' '}
            {review.shortsEligible
              ? 'possibly Shorts-eligible'
              : 'no Shorts claim'}
          </p>
          <p>
            <strong>Status:</strong> {review.status};{' '}
            {review.youtubeUploadedBytes.toLocaleString()} of{' '}
            {review.mediaSizeBytes?.toLocaleString() ?? '?'} bytes confirmed.{' '}
            {review.youtubeProcessingStatus ?? ''}
          </p>
          {review.errorCode && <p>Safe error: {review.errorCode}</p>}
          {review.providerPostId && (
            <p>
              YouTube returned ID: {review.providerPostId}{' '}
              {review.watchUrl && (
                <a
                  href={review.watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on YouTube
                </a>
              )}
            </p>
          )}
          {review.status === 'READY' && (
            <button
              className="button"
              disabled={busy || disabled || dirty}
              onClick={() => void action('confirm')}
            >
              Upload to YouTube — explicit confirmation
            </button>
          )}
          {review.status === 'UNCERTAIN' && !review.providerPostId && (
            <button
              className="secondary-button"
              disabled={busy || disabled}
              onClick={() => void action('resume')}
            >
              Probe and continue same session
            </button>
          )}
          {['UNCERTAIN', 'PROCESSING'].includes(review.status) &&
            review.providerPostId && (
              <button
                className="secondary-button"
                disabled={busy || disabled}
                onClick={() => void action('check')}
              >
                Check YouTube status
              </button>
            )}
          {review.status === 'UNCERTAIN' && (
            <p>Do not create a new upload until this outcome is reconciled.</p>
          )}
        </div>
      )}
      <h3>Upload history</h3>
      {history.length === 0 && <p>No YouTube uploads for this draft yet.</p>}
      <ul className="social-list">
        {history.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setReview(item)}
            >
              {item.youtubeTitle} · {item.youtubePrivacy} · {item.status} ·{' '}
              {new Date(item.createdAt).toLocaleString()}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
