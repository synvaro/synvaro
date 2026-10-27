'use client';
import { useEffect, useMemo, useState } from 'react';

type Asset = {
  id: string;
  originalFilename: string;
  mimeType: string;
  durationMs: number | null;
  origin: string;
};
type Scene = {
  mediaAssetId: string;
  imageDurationSec?: number;
  videoStartSec?: number;
  videoDurationSec?: number;
  text?: string;
  placement?: 'top' | 'center' | 'bottom';
};
type Render = {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  durationMs: number;
  previewAvailable: boolean;
  mediaAssetId: string | null;
  errorCode: string | null;
};
async function json(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? 'Request failed');
  return data;
}
export function ReelPanel({
  contentId,
  brandId,
  brandName,
  disabled,
  onAttached,
}: {
  contentId: string;
  brandId: string;
  brandName: string;
  disabled: boolean;
  onAttached: () => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selected, setSelected] = useState('');
  const [narration, setNarration] = useState('');
  const [render, setRender] = useState<Render | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attached, setAttached] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      json(`/api/brands/${brandId}/media`),
      json(`/api/contents/${contentId}/reels/latest`),
      json(`/api/contents/${contentId}/media`),
    ])
      .then(([media, latest, attachments]) => {
        if (!active) return;
        setAssets(media.assets);
        setRender(latest.render);
        setAttached(
          !!latest.render?.mediaAssetId &&
            attachments.attachments.some(
              (item: { mediaAssetId: string }) =>
                item.mediaAssetId === latest.render.mediaAssetId,
            ),
        );
      })
      .catch(() => {
        if (active) setError('Unable to load Reel media or status.');
      });
    return () => {
      active = false;
    };
  }, [brandId, contentId]);
  useEffect(() => {
    if (!render || !['QUEUED', 'RUNNING'].includes(render.status)) return;
    let active = true;
    const poll = () => {
      void json(`/api/reels/${render.id}`)
        .then((next) => {
          if (active) setRender(next);
        })
        .catch(() => {
          if (active)
            setError('Render status unavailable. Refresh to check again.');
        });
    };
    const timer = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [render]);
  const visual = assets.filter((a) =>
    ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(a.mimeType),
  );
  const audio = assets.filter((a) => a.mimeType === 'audio/mpeg');
  const total = useMemo(
    () =>
      scenes.reduce(
        (sum, scene) =>
          sum + (scene.imageDurationSec ?? scene.videoDurationSec ?? 0),
        0,
      ),
    [scenes],
  );
  const update = (index: number, patch: Partial<Scene>) =>
    setScenes((previous) =>
      previous.map((scene, i) =>
        i === index ? { ...scene, ...patch } : scene,
      ),
    );
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reel action failed.');
    } finally {
      setBusy(false);
    }
  };
  const active = render && ['QUEUED', 'RUNNING'].includes(render.status);
  return (
    <section className="brand-form-card" aria-label="Reels Assembly">
      <h2>Create Reel</h2>
      <p>
        Combine existing media for <strong>{brandName}</strong>. Rendering uses
        local FFmpeg, not AI credits. Your draft and source files stay
        unchanged.
      </p>
      <p>
        Vertical 1080×1920 MP4 · 30 fps · up to 10 scenes / 60 seconds. Images
        are contained; videos are cropped. Source video audio is muted.
      </p>
      <fieldset disabled={busy || disabled || !!active}>
        <label htmlFor="reel-source">Add image or video from {brandName}</label>
        <select
          id="reel-source"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select media</option>
          {visual.map((a) => (
            <option key={a.id} value={a.id}>
              {a.originalFilename} ({a.mimeType})
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary-button"
          disabled={!selected || scenes.length >= 10}
          onClick={() => {
            const asset = visual.find((a) => a.id === selected);
            if (!asset) return;
            setScenes([
              ...scenes,
              asset.mimeType.startsWith('image/')
                ? { mediaAssetId: asset.id, imageDurationSec: 3 }
                : {
                    mediaAssetId: asset.id,
                    videoStartSec: 0,
                    videoDurationSec: Math.max(
                      1,
                      Math.min(
                        5,
                        Math.floor((asset.durationMs ?? 1000) / 1000),
                      ),
                    ),
                  },
            ]);
            setSelected('');
          }}
        >
          Add scene
        </button>
        {!visual.length && (
          <p>No eligible images or videos in this brand. Upload media first.</p>
        )}
        <ol>
          {scenes.map((scene, index) => {
            const asset = visual.find((a) => a.id === scene.mediaAssetId);
            const image = !!scene.imageDurationSec;
            return (
              <li
                key={`${scene.mediaAssetId}-${index}`}
                className="brand-form-card"
              >
                <strong>
                  {index + 1}. {asset?.originalFilename ?? 'Unknown asset'}
                </strong>{' '}
                · {image ? 'Image' : 'Video'}
                <div className="form-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={index === 0}
                    onClick={() =>
                      setScenes((previous) => {
                        const next = [...previous];
                        [next[index - 1], next[index]] = [
                          next[index]!,
                          next[index - 1]!,
                        ];
                        return next;
                      })
                    }
                  >
                    Move Up
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={index === scenes.length - 1}
                    onClick={() =>
                      setScenes((previous) => {
                        const next = [...previous];
                        [next[index], next[index + 1]] = [
                          next[index + 1]!,
                          next[index]!,
                        ];
                        return next;
                      })
                    }
                  >
                    Move Down
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setScenes((previous) =>
                        previous.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
                {image ? (
                  <label>
                    Image seconds{' '}
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={scene.imageDurationSec}
                      onChange={(e) =>
                        update(index, {
                          imageDurationSec: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ) : (
                  <>
                    <label>
                      Start at (seconds){' '}
                      <input
                        type="number"
                        min={0}
                        max={3600}
                        value={scene.videoStartSec}
                        onChange={(e) =>
                          update(index, {
                            videoStartSec: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Clip seconds{' '}
                      <input
                        type="number"
                        min={1}
                        max={15}
                        value={scene.videoDurationSec}
                        onChange={(e) =>
                          update(index, {
                            videoDurationSec: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <small>
                      Source length:{' '}
                      {((asset?.durationMs ?? 0) / 1000).toFixed(1)} seconds.
                    </small>
                  </>
                )}
                <label>
                  Text overlay (optional){' '}
                  <input
                    maxLength={120}
                    value={scene.text ?? ''}
                    onChange={(e) =>
                      update(index, { text: e.target.value || undefined })
                    }
                  />
                </label>
                <label>
                  Text position{' '}
                  <select
                    value={scene.placement ?? 'bottom'}
                    onChange={(e) =>
                      update(index, {
                        placement: e.target.value as Scene['placement'],
                      })
                    }
                  >
                    <option value="top">Top</option>
                    <option value="center">Center</option>
                    <option value="bottom">Bottom</option>
                  </select>
                </label>
              </li>
            );
          })}
        </ol>
        <label htmlFor="reel-narration">Narration MP3 (optional)</label>
        <select
          id="reel-narration"
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
        >
          <option value="">No narration — silent video</option>
          {audio.map((a) => (
            <option key={a.id} value={a.id}>
              {a.originalFilename}
            </option>
          ))}
        </select>
        <p role="status">
          Estimated scene duration: {total} / 60 seconds. Short narration is
          padded with silence; long narration is trimmed.
        </p>
        <button
          type="button"
          className="button"
          disabled={!scenes.length || total > 60 || total < 1}
          onClick={() =>
            void action(async () => {
              const next = await json(
                `/api/contents/${contentId}/reels`,
                'POST',
                {
                  requestId: crypto.randomUUID(),
                  scenes,
                  ...(narration ? { narrationAssetId: narration } : {}),
                },
              );
              setRender(next);
              setAttached(false);
              setNotice('Render queued. Status resumes after refresh.');
            })
          }
        >
          Render Reel
        </button>
      </fieldset>
      {render && (
        <section aria-label="Reel result">
          <h3>Reel render · {render.status}</h3>
          <p>
            {(render.durationMs / 1000).toFixed(1)} seconds
            {render.errorCode ? ` · ${render.errorCode}` : ''}
          </p>
          {(render.previewAvailable || render.mediaAssetId) && (
            <video
              controls
              preload="metadata"
              style={{ width: '100%', maxWidth: 360 }}
              src={
                render.mediaAssetId
                  ? `/api/media/${render.mediaAssetId}/file`
                  : `/api/reels/${render.id}/file`
              }
            >
              Protected Reel preview
            </video>
          )}
          {render.previewAvailable && !render.mediaAssetId && (
            <div className="form-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const asset = await json(
                      `/api/reels/${render.id}/accept`,
                      'POST',
                      {},
                    );
                    setRender(await json(`/api/reels/${render.id}`));
                    setAssets((previous) => [asset, ...previous]);
                    setNotice('Reel saved privately to this brand.');
                  })
                }
              >
                Save to Media Library
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    setRender(
                      await json(`/api/reels/${render.id}`, 'DELETE', {}),
                    );
                    setNotice('Unsaved Reel preview discarded.');
                  })
                }
              >
                Discard
              </button>
            </div>
          )}
          {render.mediaAssetId && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy || disabled || attached}
              onClick={() =>
                void action(async () => {
                  await json(`/api/contents/${contentId}/media`, 'POST', {
                    mediaAssetId: render.mediaAssetId,
                  });
                  setAttached(true);
                  onAttached();
                  setNotice('Reel attached without changing draft text.');
                })
              }
            >
              {attached ? 'Reel attached' : 'Attach to draft'}
            </button>
          )}
          {render.status === 'FAILED' && (
            <p>
              The local render failed. Review the scenes and submit a new render
              if needed.
            </p>
          )}
        </section>
      )}
      <p role="status">{notice}</p>
      <p role="alert" className="form-error">
        {error}
      </p>
    </section>
  );
}
