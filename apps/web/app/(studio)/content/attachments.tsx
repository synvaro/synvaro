'use client';
import { useEffect, useState } from 'react';
import type { ContentMedia, MediaAsset } from '@synvaro/contracts';
export function AttachedMedia({
  contentId,
  brand,
  disabled,
}: {
  contentId: string;
  brand: { id: string; name: string };
  disabled: boolean;
}) {
  const [attachments, setAttachments] = useState<ContentMedia[]>([]);
  const [library, setLibrary] = useState<MediaAsset[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const results = await Promise.all([
          fetch(`/api/contents/${contentId}/media`, {
            signal: controller.signal,
            cache: 'no-store',
          }),
          fetch(`/api/brands/${brand.id}/media`, {
            signal: controller.signal,
            cache: 'no-store',
          }),
        ]);
        if (results.some((response) => !response.ok))
          throw new Error(
            'Unable to load attached media. Check your session and try again.',
          );
        const [attached, assets] = await Promise.all(
          results.map((response) => response.json()),
        );
        if (!controller.signal.aborted) {
          setAttachments(attached.attachments);
          setLibrary(assets.assets);
          setSelected('');
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : 'Unable to load media',
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [contentId, brand.id, reload]);
  async function change(
    method: string,
    suffix: string,
    body: unknown,
    message: string,
  ) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(
        `/api/contents/${contentId}/media${suffix}`,
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          `${result.message ?? 'Unable to change attachments'}. Reload media if another session changed this draft. Your text is still here.`,
        );
      setAttachments(result.attachments);
      setSelected('');
      setNotice(message);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to connect. Your text is still here.',
      );
    } finally {
      setBusy(false);
    }
  }
  function move(index: number, delta: number) {
    const ids = attachments.map((item) => item.mediaAssetId);
    [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!];
    void change(
      'PUT',
      '/order',
      { mediaAssetIds: ids },
      'Attachment order saved.',
    );
  }
  const available = library.filter(
    (asset) => !attachments.some((item) => item.mediaAssetId === asset.id),
  );
  return (
    <section aria-labelledby="attached-media-title">
      <h2 id="attached-media-title">Attached Media</h2>
      <p>
        Media for {brand.name}. Attachment changes save immediately and keep
        your unsaved text.
      </p>
      <fieldset
        disabled={disabled || loading || busy}
        className="attachment-controls"
      >
        <div className="brand-selector">
          <label htmlFor="attach-media">Add media from {brand.name}</label>
          <select
            id="attach-media"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Select existing media</option>
            {available.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.origin === 'AI_GENERATED'
                  ? 'AI generated · '
                  : asset.origin === 'AI_EDITED'
                    ? 'AI edited · '
                    : ''}
                {asset.originalFilename} ({asset.mimeType})
              </option>
            ))}
          </select>
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="button"
            disabled={!selected}
            onClick={() =>
              void change(
                'POST',
                '',
                { mediaAssetId: selected },
                'Media attached.',
              )
            }
          >
            Attach media
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setNotice('');
              setReload((value) => value + 1);
            }}
          >
            Reload media
          </button>
        </div>
        {!loading && !available.length && (
          <p>
            {library.length
              ? 'All current brand media is attached.'
              : 'This brand has no media yet. Upload originals in Media Library first.'}
          </p>
        )}
        {!loading && !attachments.length && (
          <p>No media attached to this draft.</p>
        )}
        <ol className="media-grid">
          {attachments.map((item, index) => (
            <li className="brand-card media-card" key={item.mediaAssetId}>
              {item.asset.mimeType === 'video/mp4' ? (
                <video
                  controls
                  preload="metadata"
                  src={`/api/media/${item.mediaAssetId}/file`}
                  aria-label={item.asset.originalFilename}
                />
              ) : (
                // Authenticated originals must bypass public optimization caches.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/media/${item.mediaAssetId}/file`}
                  alt={item.asset.originalFilename}
                  loading="lazy"
                />
              )}
              <h3>
                {index + 1}. {item.asset.originalFilename}
              </h3>
              <p>{item.asset.mimeType}</p>
              {(item.asset.origin === 'AI_GENERATED' ||
                item.asset.origin === 'AI_EDITED') && (
                <p>
                  <span className="badge">
                    {item.asset.origin === 'AI_EDITED'
                      ? 'AI EDITED'
                      : 'AI GENERATED'}
                  </span>{' '}
                  {item.asset.origin === 'AI_EDITED'
                    ? 'Review against the original image before use.'
                    : 'Conceptual visual, not authentic product photography.'}
                </p>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary-button"
                  aria-label={`Move up ${item.asset.originalFilename}`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  Move Up
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  aria-label={`Move down ${item.asset.originalFilename}`}
                  disabled={index === attachments.length - 1}
                  onClick={() => move(index, 1)}
                >
                  Move Down
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  aria-label={`Detach ${item.asset.originalFilename}`}
                  onClick={() =>
                    void change(
                      'DELETE',
                      `/${item.mediaAssetId}`,
                      {},
                      'Media detached. The original remains in Media Library.',
                    )
                  }
                >
                  Detach
                </button>
              </div>
            </li>
          ))}
        </ol>
      </fieldset>
      <p role="status" className="form-notice">
        {loading
          ? 'Loading attached media…'
          : busy
            ? 'Saving attachments…'
            : notice}
      </p>
      <p role="alert" className="form-error">
        {error}
      </p>
    </section>
  );
}
