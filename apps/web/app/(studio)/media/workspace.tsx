'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { MediaAsset } from '@synvaro/contracts';

export function MediaWorkspace({
  brands,
  initialBrand,
}: {
  brands: { id: string; name: string }[];
  initialBrand: string;
}) {
  const [brandId, setBrandId] = useState(initialBrand);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const brand = brands.find((item) => item.id === brandId);
  useEffect(() => {
    if (!brandId) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      setAssets([]);
      try {
        const response = await fetch(`/api/brands/${brandId}/media`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.message ?? 'Unable to load media');
        if (!controller.signal.aborted) setAssets(result.assets);
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
  }, [brandId]);
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setStatus('');
    const file = input.current?.files?.[0];
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Maximum file size is 20 MiB.');
      return;
    }
    setUploading(true);
    try {
      const data = new FormData();
      data.append('file', file);
      const response = await fetch(`/api/brands/${brandId}/media`, {
        method: 'POST',
        body: data,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Upload failed');
      setAssets((previous) => [result.asset, ...previous]);
      setStatus(`Uploaded ${result.asset.originalFilename} to ${brand?.name}.`);
      if (input.current) input.current.value = '';
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Upload failed. Please try again.',
      );
    } finally {
      setUploading(false);
    }
  }
  if (!brands.length)
    return (
      <section className="empty-state">
        <h2>Create a brand first</h2>
        <p>Media belongs to a brand.</p>
        <Link className="auth-link" href="/brands">
          Go to Brands
        </Link>
      </section>
    );
  return (
    <>
      <div className="brand-selector">
        <label htmlFor="media-brand">Brand</label>
        <select
          id="media-brand"
          value={brandId}
          disabled={uploading}
          onChange={(event) => {
            const id = event.target.value;
            setBrandId(id);
            setAssets([]);
            setStatus('');
            setError('');
            if (input.current) input.current.value = '';
            window.history.replaceState(
              null,
              '',
              id ? `/media?brandId=${id}` : '/media',
            );
          }}
        >
          <option value="">Select a brand</option>
          {brands.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      {!brand ? (
        <section className="empty-state">
          <h2>Select a brand</h2>
          <p>Choose which brand’s media you want to manage.</p>
        </section>
      ) : (
        <>
          <h2 className="content-brand-name">{brand.name}</h2>
          <form
            className="brand-form-card media-upload"
            onSubmit={upload}
            aria-label={`Upload to ${brand.name}`}
          >
            <fieldset>
              <label htmlFor="media-file">
                Upload original media to {brand.name}
              </label>
              <input
                ref={input}
                id="media-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4"
                disabled={uploading || loading}
              />
              <p>
                JPEG, PNG, static WebP or H.264 MP4. Maximum 20 MiB; images up
                to 16 megapixels. Originals are preserved.
              </p>
              <button
                className="button"
                type="submit"
                disabled={uploading || loading}
              >
                {uploading ? 'Uploading and validating…' : 'Upload file'}
              </button>
              {uploading && (
                <p role="status">
                  Uploading and checking the original file. Please keep this
                  page open.
                </p>
              )}
            </fieldset>
          </form>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {status && <p role="status">{status}</p>}
          {loading ? (
            <p role="status">Loading media…</p>
          ) : !assets.length ? (
            <section className="empty-state">
              <h2>No media yet</h2>
              <p>Upload the first image or video for {brand.name}.</p>
            </section>
          ) : (
            <ul className="media-grid">
              {assets.map((asset) => (
                <li className="brand-card media-card" key={asset.id}>
                  {asset.mimeType === 'video/mp4' ? (
                    <video
                      controls
                      preload="metadata"
                      src={`/api/media/${asset.id}/file`}
                      aria-label={asset.originalFilename}
                    /> /* Authenticated originals must bypass public image optimization caches. */
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/media/${asset.id}/file`}
                      alt={asset.originalFilename}
                      loading="lazy"
                    />
                  )}
                  <h3>{asset.originalFilename}</h3>
                  {(asset.origin === 'AI_GENERATED' ||
                    asset.origin === 'AI_EDITED') && (
                    <p>
                      <span className="badge">
                        {asset.origin === 'AI_EDITED'
                          ? 'AI EDITED'
                          : 'AI GENERATED'}
                      </span>{' '}
                      {asset.origin === 'AI_EDITED'
                        ? 'Review product details against the original.'
                        : 'Conceptual visual, not authentic product photography.'}{' '}
                      {asset.origin === 'AI_EDITED'
                        ? 'AI-edited'
                        : 'AI-generated'}{' '}
                      · {asset.generation?.provider} · {asset.generation?.model}
                    </p>
                  )}
                  {asset.generation?.sourceMediaAssetId && (
                    <p>
                      <a
                        className="auth-link"
                        href={`/api/media/${asset.generation.sourceMediaAssetId}/file`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View original source
                      </a>
                    </p>
                  )}
                  <p>
                    {asset.mimeType} · {(asset.sizeBytes / 1024).toFixed(1)} KiB
                  </p>
                  <p>
                    {asset.origin === 'UPLOADED' ? 'Uploaded' : 'Saved'}{' '}
                    <time dateTime={asset.createdAt}>
                      {new Date(asset.createdAt)
                        .toISOString()
                        .replace('T', ' ')
                        .slice(0, 16)}{' '}
                      UTC
                    </time>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
